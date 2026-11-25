import { test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_CHAIN } from "../src/ai.ts";
import { createOpenCodeProvider } from "../src/providers/opencode.ts";
import { createOpenRouterProvider } from "../src/providers/openrouter.ts";

const openRouterCandidate = FALLBACK_CHAIN.find((candidate) => candidate.kind === "openrouter")!;
const openCodeCandidate = FALLBACK_CHAIN.find((candidate) => candidate.kind === "opencode")!;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("openrouter fails fast without an api key", async () => {
  let called = false;
  const provider = createOpenRouterProvider({
    apiKey: "",
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
  });
  const result = await provider.complete({ candidate: openRouterCandidate, messages: [{ role: "user", content: "hi" }] });
  assert.equal(called, false);
  assert.ok("error" in result);
  assert.equal(result.error.message, "openrouter_api_key_not_configured");
  assert.equal(result.error.status, 401);
});

test("openrouter sends free-model request with attribution headers", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = createOpenRouterProvider({
    apiKey: "test-openrouter-key",
    appUrl: "https://app.example.invalid",
    appName: "Cloud OpenCode Test",
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return jsonResponse({ choices: [{ message: { content: "OPENROUTER_OK" }, finish_reason: "stop" }] });
    },
  });

  const result = await provider.complete({
    candidate: openRouterCandidate,
    messages: [
      { role: "system", content: "Be concise" },
      { role: "user", content: "Reply with OPENROUTER_OK" },
    ],
  });

  assert.equal(capturedUrl, "https://openrouter.ai/api/v1/chat/completions");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("authorization"), "Bearer test-openrouter-key");
  assert.equal(headers.get("http-referer"), "https://app.example.invalid");
  assert.equal(headers.get("x-title"), "Cloud OpenCode Test");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.model, openRouterCandidate.modelID);
  assert.equal(body.max_tokens, 1024);
  assert.deepEqual(body.messages, [
    { role: "system", content: "Be concise" },
    { role: "user", content: "Reply with OPENROUTER_OK" },
  ]);
  assert.ok("result" in result);
  assert.equal(result.result.content, "OPENROUTER_OK");
});

test("openrouter maps provider errors for fallback decisions", async () => {
  const provider = createOpenRouterProvider({
    apiKey: "test-openrouter-key",
    fetchImpl: async () => jsonResponse({ error: { message: "rate limited", code: "rate_limit_exceeded" } }, 429),
  });
  const result = await provider.complete({ candidate: openRouterCandidate, messages: [{ role: "user", content: "hi" }] });
  assert.ok("error" in result);
  assert.equal(result.error.status, 429);
  assert.equal(result.error.kind, "rate_limit_exceeded");
  assert.equal(result.error.message, "rate limited");
});

test("opencode fails fast without an api key", async () => {
  let called = false;
  const provider = createOpenCodeProvider({
    apiKey: "",
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
  });
  const result = await provider.complete({ candidate: openCodeCandidate, messages: [{ role: "user", content: "hi" }] });
  assert.equal(called, false);
  assert.ok("error" in result);
  assert.equal(result.error.message, "opencode_api_key_not_configured");
  assert.equal(result.error.status, 401);
});

test("opencode builds a chat transcript and parses provider output", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = createOpenCodeProvider({
    apiKey: "test-opencode-key",
    baseUrl: "https://opencode.example.invalid",
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return jsonResponse({ data: { content: "OPENCODE_OK", finishReason: "stop" } });
    },
  });

  const result = await provider.complete({
    candidate: openCodeCandidate,
    messages: [
      { role: "system", content: "Be concise" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
      { role: "user", content: "Reply with OPENCODE_OK" },
    ],
  });

  assert.equal(capturedUrl, "https://opencode.example.invalid/api/experimental/generate/text");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("authorization"), `Basic ${Buffer.from("opencode:test-opencode-key").toString("base64")}`);
  const body = JSON.parse(String(capturedInit?.body));
  assert.deepEqual(body.model, { providerID: openCodeCandidate.providerID, id: openCodeCandidate.modelID });
  assert.match(body.prompt, /System:\nBe concise/);
  assert.match(body.prompt, /User:\nHello/);
  assert.match(body.prompt, /Assistant:\nHi/);
  assert.match(body.prompt, /User:\nReply with OPENCODE_OK/);
  assert.ok("result" in result);
  assert.equal(result.result.content, "OPENCODE_OK");
});
