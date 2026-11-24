import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import type { GithubConfig } from "../src/config.ts";
import {
  createGithubService,
  decryptToken,
  encryptToken,
  isGithubConfigured,
  GITHUB_OAUTH_SCOPES,
} from "../src/github.ts";

function config(overrides: Partial<GithubConfig> = {}): GithubConfig {
  return {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://backend.example.invalid/api/github/oauth/callback",
    appCallbackUrl: "cloudopencode://github/callback",
    apiBaseUrl: "https://api.github.com",
    authBaseUrl: "https://github.com",
    tokenEncryptionKey: randomBytes(32),
    ...overrides,
  };
}

test("authorization URL is least-privilege and never contains the client secret", () => {
  const cfg = config();
  const service = createGithubService(cfg);
  const url = new URL(service.authorizationUrl("state-123"));
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), cfg.redirectUri);
  assert.equal(url.searchParams.get("scope"), GITHUB_OAUTH_SCOPES);
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.get("allow_signup"), "false");
  assert.equal(url.search.includes("client-secret"), false);
});

test("token encryption round trips and rejects the wrong key", () => {
  const key = randomBytes(32);
  const encrypted = encryptToken("secret-token-value", key);
  assert.equal(decryptToken(encrypted, key), "secret-token-value");
  assert.notEqual(encrypted.ciphertext, "secret-token-value");
  assert.throws(() => decryptToken(encrypted, randomBytes(32)));
});

test("GitHub configuration requires credentials, HTTPS redirect and a 32-byte key", () => {
  assert.equal(isGithubConfigured(config()), true);
  assert.equal(isGithubConfigured(config({ clientSecret: "" })), false);
  assert.equal(isGithubConfigured(config({ redirectUri: "http://insecure.invalid/cb" })), false);
  assert.equal(isGithubConfigured(config({ tokenEncryptionKey: Buffer.alloc(16) })), false);
  assert.equal(isGithubConfigured(config({ tokenEncryptionKey: null })), false);
});

test("repository listing and creation use the public-repository contract", async () => {
  const repositoryPayload = {
    id: 7,
    full_name: "octocat/hello-app",
    name: "hello-app",
    owner: { login: "octocat" },
    private: false,
    default_branch: "main",
    html_url: "https://github.com/octocat/hello-app",
  };
  let createBody = "";
  const service = createGithubService(config(), (async (input: any, init: any) => {
    const url = String(input);
    if (url.endsWith("/user/repos") && init?.method === "POST") {
      createBody = String(init.body);
      return new Response(JSON.stringify(repositoryPayload), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([repositoryPayload]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
  const repositories = await service.listRepositories("token");
  assert.equal(repositories.length, 1);
  assert.equal(repositories[0].fullName, "octocat/hello-app");
  assert.equal(repositories[0].isPrivate, false);

  const created = await service.createRepository("token", { name: "hello-app", description: "test" });
  assert.equal(created.id, 7);
  const body = JSON.parse(createBody);
  assert.equal(body.private, false);
  assert.equal(body.auto_init, true);
});

test("file reads and commits use the GitHub contents API safely", async () => {
  let readUrl = "";
  let writeUrl = "";
  let writeBody: any = null;
  const filePayload = {
    path: "app/src/main/Hello.kt",
    sha: "blob-sha",
    content: Buffer.from("class Hello\n", "utf8").toString("base64"),
  };
  const service = createGithubService(config(), (async (input: any, init: any) => {
    assert.equal(init.headers.Authorization, "Bearer token");
    if (init.method === "PUT") {
      writeUrl = String(input);
      writeBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        content: { html_url: "https://github.com/octocat/app/commit/content" },
        commit: { sha: "commit-sha" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    readUrl = String(input);
    return new Response(JSON.stringify(filePayload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);

  const file = await service.getFile("token", {
    owner: "octocat",
    repo: "app",
    path: "app/src/main/Hello.kt",
    branch: "main",
  });
  assert.equal(file?.content, "class Hello\n");
  assert.equal(file?.sha, "blob-sha");
  assert.match(readUrl, /\/repos\/octocat\/app\/contents\/app\/src\/main\/Hello\.kt\?ref=main$/);

  const commit = await service.upsertFile("token", {
    owner: "octocat",
    repo: "app",
    path: "app/src/main/Hello.kt",
    content: "class Hello\n",
    message: "add hello",
    branch: "main",
    sha: "blob-sha",
  });
  assert.equal(commit.sha, "commit-sha");
  assert.match(writeUrl, /\/repos\/octocat\/app\/contents\/app\/src\/main\/Hello\.kt$/);
  assert.equal(writeBody.message, "add hello");
  assert.equal(writeBody.branch, "main");
  assert.equal(writeBody.sha, "blob-sha");
  assert.equal(Buffer.from(writeBody.content, "base64").toString("utf8"), "class Hello\n");
});

test("workflow dispatch and monitoring use actual GitHub run results", async () => {
  let dispatchBody = "";
  const now = Date.now();
  const runPayload = {
    id: 99,
    status: "in_progress",
    conclusion: null,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    html_url: "https://github.com/octocat/app/actions/runs/99",
    head_branch: "main",
    event: "workflow_dispatch",
  };
  const service = createGithubService(config(), (async (input: any, init: any) => {
    const url = String(input);
    assert.equal(init.headers.Authorization, "Bearer token");
    if (url.endsWith("/dispatches")) {
      dispatchBody = String(init.body);
      return new Response(null, { status: 204 });
    }
    if (url.includes("/workflows/android-build.yml/runs")) {
      return new Response(JSON.stringify({ workflow_runs: [
        runPayload,
        { ...runPayload, id: 98, event: "push" },
      ] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/actions/runs/99/jobs")) {
      return new Response(JSON.stringify({ jobs: [{
        id: 7,
        name: "build",
        status: "in_progress",
        conclusion: null,
        steps: [
          { name: "Checkout", status: "completed", conclusion: "success" },
          { name: "Assemble", status: "in_progress", conclusion: null },
        ],
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(runPayload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);

  await service.dispatchWorkflow("token", {
    owner: "octocat",
    repo: "app",
    workflowPath: ".github/workflows/android-build.yml",
    ref: "main",
  });
  assert.deepEqual(JSON.parse(dispatchBody), { ref: "main" });

  const runs = await service.listWorkflowRuns("token", {
    owner: "octocat",
    repo: "app",
    workflowPath: ".github/workflows/android-build.yml",
    ref: "main",
    createdAfter: now - 1000,
  });
  assert.deepEqual(runs.map((run) => run.id), [99]);

  const run = await service.getWorkflowRun("token", { owner: "octocat", repo: "app", runId: 99 });
  assert.equal(run.status, "in_progress");
  assert.equal(run.conclusion, null);

  const jobs = await service.listWorkflowJobs("token", { owner: "octocat", repo: "app", runId: 99 });
  assert.equal(jobs[0].steps.length, 2);
  assert.equal(jobs[0].steps[0].conclusion, "success");
});

test("artifact listing and authorized download use the successful run", async () => {
  const zipBytes = new Uint8Array([1, 2, 3, 4]);
  let downloadAuth = "";
  let redirectAuth = "unset";
  const service = createGithubService(config(), (async (input: any, init: any) => {
    const url = String(input);
    if (url.endsWith("/actions/runs/99/artifacts")) {
      assert.equal(init.headers.Authorization, "Bearer token");
      return new Response(JSON.stringify({ artifacts: [{
        id: 7,
        name: "app-debug-apk",
        size_in_bytes: 4,
        expired: false,
        created_at: new Date().toISOString(),
        html_url: "https://github.com/octocat/app/actions/runs/99/artifacts/7",
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/actions/artifacts/7/zip")) {
      downloadAuth = init.headers.Authorization;
      return new Response(null, { status: 302, headers: { Location: "https://artifacts.example.invalid/a.zip" } });
    }
    redirectAuth = init?.headers?.Authorization ?? "none";
    return new Response(zipBytes, {
      status: 200,
      headers: { "Content-Disposition": "attachment; filename=artifact.zip" },
    });
  }) as typeof fetch);

  const artifacts = await service.listWorkflowArtifacts("token", { owner: "octocat", repo: "app", runId: 99 });
  assert.equal(artifacts[0].id, 7);
  assert.equal(artifacts[0].name, "app-debug-apk");
  const downloaded = await service.downloadWorkflowArtifact("token", { owner: "octocat", repo: "app", artifactId: 7 });
  assert.equal(downloadAuth, "Bearer token");
  assert.equal(redirectAuth, "none");
  assert.deepEqual(Array.from(downloaded.bytes), [1, 2, 3, 4]);
  assert.equal(downloaded.suggestedFilename, "artifact.zip");
});

test("OAuth code exchange succeeds and never echoes provider errors with token material", async () => {
  const service = createGithubService(config(), (async (input: any, init: any) => {
    assert.equal(String(input), "https://github.com/login/oauth/access_token");
    assert.equal(init.method, "POST");
    assert.equal(String(init.body).includes("client-secret"), true);
    return new Response(JSON.stringify({ access_token: "exchange-token", scope: "public_repo workflow" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch);
  const exchange = await service.exchangeCode("code-123");
  assert.equal(exchange.accessToken, "exchange-token");
  assert.equal(exchange.scope, "public_repo workflow");

  const failing = createGithubService(config(), (async () =>
    new Response(JSON.stringify({ error: "bad_verification_code", access_token: "do-not-leak" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch);
  await assert.rejects(failing.exchangeCode("bad"), (error: any) => {
    assert.equal(error.code, "oauth_exchange_rejected");
    assert.equal(String(error.message).includes("do-not-leak"), false);
    return true;
  });
});
