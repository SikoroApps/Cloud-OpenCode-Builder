import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { GithubConfig } from "../src/config.ts";
import type { ApiDependencies } from "../src/http.ts";
import { createApiHandler } from "../src/http.ts";
import type { GithubService } from "../src/github.ts";
import type { AiFilePlanner } from "../src/files.ts";
import { insertGithubState } from "../src/db.ts";

process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-phase5-oauth-")), "test.sqlite");

function githubConfig(configured = true): GithubConfig {
  return {
    clientId: configured ? "client-id" : "",
    clientSecret: configured ? "client-secret" : "",
    redirectUri: configured ? "https://backend.example.invalid/api/github/oauth/callback" : "",
    appCallbackUrl: "cloudopencode://github/callback",
    apiBaseUrl: "https://api.github.com",
    authBaseUrl: "https://github.com",
    tokenEncryptionKey: configured ? randomBytes(32) : null,
  };
}

function mockService(): GithubService {
  return {
    authorizationUrl(state: string) {
      return `https://github.example.invalid/login/oauth/authorize?state=${encodeURIComponent(state)}`;
    },
    async exchangeCode() {
      return { accessToken: "gh-token-do-not-expose", scope: "public_repo workflow", tokenType: "bearer" };
    },
    async fetchIdentity() {
      return { id: 42, login: "octocat" };
    },
    async revokeToken() {
      return true;
    },
    async listRepositories() {
      return [];
    },
    async getRepository() {
      throw new Error("not used");
    },
    async repositoryExists() {
      return false;
    },
    async createRepository() {
      throw new Error("not used");
    },
    async getFile() {
      return null;
    },
    async upsertFile() {
      throw new Error("not used");
    },
    async dispatchWorkflow() {},
    async listWorkflowRuns() {
      return [];
    },
    async getWorkflowRun() {
      throw new Error("not used");
    },
    async listWorkflowJobs() {
      return [];
    },
    async listWorkflowArtifacts() {
      return [];
    },
    async downloadWorkflowArtifact() {
      throw new Error("not used");
    },
  };
}

function deps(configured = true): ApiDependencies {
  const aiFilePlanner: AiFilePlanner = async () => ({ model: "mock", operations: [] });
  return {
    githubConfig: githubConfig(configured),
    githubService: mockService(),
    aiFilePlanner,
  };
}

async function startServer(dependencies: ApiDependencies): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer(createApiHandler(dependencies));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function register(baseUrl: string): Promise<Record<string, string>> {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `oauth-${Date.now()}-${randomBytes(4).toString("hex")}@example.invalid`,
      password: "password-1234",
    }),
  });
  assert.equal(response.status, 201);
  return { Authorization: `Bearer ${String(((await response.json()) as any).token)}` };
}

async function beginState(baseUrl: string, auth: Record<string, string>): Promise<string> {
  const response = await fetch(`${baseUrl}/api/github/oauth/start`, { headers: auth });
  assert.equal(response.status, 200);
  const state = new URL(String(((await response.json()) as any).authorizationUrl)).searchParams.get("state") || "";
  assert.equal(state.length, 64);
  return state;
}

function callbackError(location: string): string {
  return new URL(location).searchParams.get("error") || "";
}

test("OAuth state is single-use and a replayed callback is rejected", async () => {
  const server = await startServer(deps());
  try {
    const auth = await register(server.baseUrl);
    const state = await beginState(server.baseUrl, auth);
    const first = await fetch(`${server.baseUrl}/api/github/oauth/callback?code=abc&state=${state}`, { redirect: "manual" });
    assert.equal(first.status, 302);
    assert.equal(new URL(first.headers.get("location") || "").searchParams.get("status"), "connected");

    const replay = await fetch(`${server.baseUrl}/api/github/oauth/callback?code=abc&state=${state}`, { redirect: "manual" });
    assert.equal(replay.status, 302);
    assert.equal(callbackError(replay.headers.get("location") || ""), "invalid_state");

    const status = await fetch(`${server.baseUrl}/api/github/status`, { headers: auth });
    assert.equal(status.status, 200);
    assert.equal(JSON.stringify(await status.json()).includes("gh-token-do-not-expose"), false);
  } finally {
    await server.close();
  }
});

test("expired OAuth state is rejected before a token exchange", async () => {
  const server = await startServer(deps());
  try {
    const state = randomBytes(32).toString("hex");
    const now = Date.now();
    insertGithubState(createHash("sha256").update(state).digest("hex"), "expired-user", now - 10_000, now - 5_000);
    const response = await fetch(`${server.baseUrl}/api/github/oauth/callback?code=abc&state=${state}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(callbackError(response.headers.get("location") || ""), "invalid_state");
  } finally {
    await server.close();
  }
});

test("denied and malformed callbacks redirect with safe errors", async () => {
  const server = await startServer(deps());
  try {
    let response = await fetch(`${server.baseUrl}/api/github/oauth/callback?error=access_denied`, { redirect: "manual" });
    assert.equal(callbackError(response.headers.get("location") || ""), "github_denied");
    response = await fetch(`${server.baseUrl}/api/github/oauth/callback?code=abc`, { redirect: "manual" });
    assert.equal(callbackError(response.headers.get("location") || ""), "invalid_callback");
    response = await fetch(`${server.baseUrl}/api/github/oauth/callback?code=abc&state=unknown`, { redirect: "manual" });
    assert.equal(callbackError(response.headers.get("location") || ""), "invalid_state");
  } finally {
    await server.close();
  }
});

test("unconfigured GitHub OAuth fails safely without generated credentials", async () => {
  const server = await startServer(deps(false));
  try {
    const auth = await register(server.baseUrl);
    const start = await fetch(`${server.baseUrl}/api/github/oauth/start`, { headers: auth });
    assert.equal(start.status, 503);
    assert.deepEqual(await start.json(), { error: "github_not_configured" });

    const callback = await fetch(`${server.baseUrl}/api/github/oauth/callback?code=abc&state=${randomBytes(32).toString("hex")}`, { redirect: "manual" });
    assert.equal(callbackError(callback.headers.get("location") || ""), "github_not_configured");
    assert.equal(callback.headers.get("location")?.includes("gh-token-do-not-expose"), false);
  } finally {
    await server.close();
  }
});
