import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWebSearchService,
  decodeHtmlEntities,
  normalizeResultUrl,
  parseDuckDuckGoHtml,
  WebSearchError,
} from "../src/web-search.ts";
import { baseDependencies, registerUser, startServer } from "./phase6-8-helpers.ts";

process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-phase8-search-")), "test.sqlite");
process.env.CLOUD_AI_STUB = "1";

const FIXTURE = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.android.com%2Fguide%2Ftopics%2Farchitecture&amp;rut=abc">
      Android <b>architecture</b> guide
    </a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.android.com%2Fguide%2Ftopics%2Farchitecture">Official guidance for <b>Android</b> app architecture.</a>
</div>
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://kotlinlang.org/docs/home.html">Kotlin documentation &amp; guides</a>
  </h2>
  <a class="result__snippet">Learn Kotlin for Android &amp; JVM.</a>
</div>
`;

test("DuckDuckGo HTML parsing extracts safe titles, snippets and redirect targets", () => {
  const results = parseDuckDuckGoHtml(FIXTURE, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Android architecture guide");
  assert.equal(results[0].url, "https://developer.android.com/guide/topics/architecture");
  assert.equal(results[0].snippet, "Official guidance for Android app architecture.");
  assert.equal(results[1].url, "https://kotlinlang.org/docs/home.html");
  assert.equal(results[1].title, "Kotlin documentation & guides");
  assert.equal(decodeHtmlEntities("&lt;b&gt;x&lt;/b&gt;"), "<b>x</b>");
  assert.equal(normalizeResultUrl("javascript:alert(1)"), null);
});

test("web search service returns parsed results and rejects unsafe or failed responses", async () => {
  let requested = "";
  const service = createWebSearchService({
    endpoint: "https://search.example.invalid/html",
    fetchImpl: async (input) => {
      requested = String(input);
      return new Response(FIXTURE, { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  const result = await service.search({ query: "android architecture", limit: 1 });
  assert.equal(result.provider, "duckduckgo_html");
  assert.equal(result.query, "android architecture");
  assert.equal(result.results.length, 1);
  assert.equal(new URL(requested).searchParams.get("q"), "android architecture");

  const failed = createWebSearchService({
    fetchImpl: async () => new Response("blocked", { status: 503 }),
  });
  await assert.rejects(
    () => failed.search({ query: "android" }),
    (error: unknown) => error instanceof WebSearchError && error.code === "web_search_failed",
  );
});

test("cloud tasks are persisted, owner-scoped and can be updated or cancelled", async () => {
  const dependencies = baseDependencies();
  let server = await startServer(dependencies);
  try {
    const auth = await registerUser(server.baseUrl);
    const created = await fetch(`${server.baseUrl}/api/tasks`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Create a Compose settings screen" }),
    });
    assert.equal(created.status, 201);
    const task = (await created.json()) as any;
    assert.equal(task.task.status, "queued");
    assert.equal(task.task.description, "Create a Compose settings screen");
    const taskId = String(task.task.id);

    const listed = await fetch(`${server.baseUrl}/api/tasks`, { headers: auth });
    assert.equal(listed.status, 200);
    assert.equal(((await listed.json()) as any).tasks.length, 1);

    const updated = await fetch(`${server.baseUrl}/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "running" }),
    });
    assert.equal(updated.status, 200);
    assert.equal(((await updated.json()) as any).task.status, "running");

    const invalid = await fetch(`${server.baseUrl}/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "not-a-status" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as any).error, "invalid_task_status");

    const other = await registerUser(server.baseUrl);
    const forbidden = await fetch(`${server.baseUrl}/api/tasks/${taskId}`, { headers: other });
    assert.equal(forbidden.status, 404);

    await server.close();
    server = await startServer(dependencies);
    const afterRestart = await fetch(`${server.baseUrl}/api/tasks/${taskId}`, { headers: auth });
    assert.equal(afterRestart.status, 200);
    assert.equal(((await afterRestart.json()) as any).task.status, "running");

    const cancelled = await fetch(`${server.baseUrl}/api/tasks/${taskId}`, {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(cancelled.status, 200);
    assert.equal(((await cancelled.json()) as any).task.status, "cancelled");
  } finally {
    await server.close();
  }
});

test("chat can use realtime web search context and returns the sources", async () => {
  const server = await startServer(baseDependencies({
    webSearchService: {
      async search({ query }) {
        return {
          query: String(query),
          provider: "mock-search",
          results: [{ title: "Android docs", url: "https://developer.android.com", snippet: "Official docs" }],
        };
      },
    },
  }));
  try {
    const auth = await registerUser(server.baseUrl);
    const response = await fetch(`${server.baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "search-chat", content: "What is new in Android?", webSearch: true }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.ai.model, "stub/local-test");
    assert.equal(body.assistantMessage.content, "STUB:What is new in Android?");
    assert.equal(body.webSearch.provider, "mock-search");
    assert.equal(body.webSearch.results[0].url, "https://developer.android.com");

    const history = await fetch(`${server.baseUrl}/api/chat/history?sessionKey=search-chat`, { headers: auth });
    assert.equal(history.status, 200);
    assert.equal(((await history.json()) as any).history.length, 2);
  } finally {
    await server.close();
  }
});

test("search failures are reported without leaking upstream details", async () => {
  const server = await startServer(baseDependencies({
    webSearchService: {
      async search() {
        throw new WebSearchError("web_search_failed", 502);
      },
    },
  }));
  try {
    const auth = await registerUser(server.baseUrl);
    const response = await fetch(`${server.baseUrl}/api/search`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "android" }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "web_search_failed" });
  } finally {
    await server.close();
  }
});
