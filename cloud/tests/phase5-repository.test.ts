import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { GithubConfig } from "../src/config.ts";
import type { ApiDependencies } from "../src/http.ts";
import { createApiHandler } from "../src/http.ts";
import { GithubServiceError, type GithubService } from "../src/github.ts";
import type { AiFilePlanner } from "../src/files.ts";

process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-phase5-repo-")), "test.sqlite");

function githubConfig(): GithubConfig {
  return {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://backend.example.invalid/api/github/oauth/callback",
    appCallbackUrl: "cloudopencode://github/callback",
    apiBaseUrl: "https://api.github.com",
    authBaseUrl: "https://github.com",
    tokenEncryptionKey: randomBytes(32),
  };
}

function mockService(permissions: { admin: boolean; maintain: boolean; push: boolean; pull: boolean } | null, missing = false): GithubService {
  const repository = {
    id: 7,
    fullName: "octocat/android-app",
    name: "android-app",
    owner: "octocat",
    isPrivate: false,
    defaultBranch: "main",
    htmlUrl: "https://github.com/octocat/android-app",
    permissions: permissions || { admin: false, maintain: false, push: false, pull: true },
  };
  return {
    authorizationUrl(state: string) {
      return `https://github.example.invalid/authorize?state=${encodeURIComponent(state)}`;
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
      return [repository];
    },
    async getRepository() {
      if (missing) throw new GithubServiceError("repository_not_found", 404);
      return repository;
    },
    async repositoryExists() {
      return !missing;
    },
    async createRepository() {
      return repository;
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

function deps(service: GithubService): ApiDependencies {
  const aiFilePlanner: AiFilePlanner = async () => ({ model: "mock", operations: [] });
  return { githubConfig: githubConfig(), githubService: service, aiFilePlanner };
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

async function connectUser(baseUrl: string): Promise<Record<string, string>> {
  const registered = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `repo-${Date.now()}-${randomBytes(4).toString("hex")}@example.invalid`,
      password: "password-1234",
    }),
  });
  assert.equal(registered.status, 201);
  const auth = { Authorization: `Bearer ${String(((await registered.json()) as any).token)}` };
  const start = await fetch(`${baseUrl}/api/github/oauth/start`, { headers: auth });
  const state = new URL(String(((await start.json()) as any).authorizationUrl)).searchParams.get("state") || "";
  const callback = await fetch(`${baseUrl}/api/github/oauth/callback?code=abc&state=${state}`, { redirect: "manual" });
  assert.equal(new URL(callback.headers.get("location") || "").searchParams.get("status"), "connected");
  return auth;
}

test("existing repository can be connected and write permissions are verified", async () => {
  const service = mockService({ admin: false, maintain: false, push: true, pull: true });
  const server = await startServer(deps(service));
  try {
    const auth = await connectUser(server.baseUrl);
    const response = await fetch(`${server.baseUrl}/api/github/repositories/connect`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ repoFullName: "octocat/android-app" }),
    });
    assert.equal(response.status, 200);
    const connected = (await response.json()) as any;
    assert.equal(connected.repository.fullName, "octocat/android-app");
    assert.equal(connected.permissions.push, true);
    assert.equal(connected.project.repoFullName, "octocat/android-app");
    assert.equal(JSON.stringify(connected).includes("gh-token-do-not-expose"), false);

    const permissions = await fetch(`${server.baseUrl}/api/github/permissions`, { headers: auth });
    assert.equal(permissions.status, 200);
    const report = (await permissions.json()) as any;
    assert.equal(report.canWrite, true);
    assert.equal(report.workflowScope, true);
    assert.equal(report.verified, true);
    assert.equal(report.connectedScopes, "public_repo workflow");
    assert.equal(JSON.stringify(report).includes("gh-token-do-not-expose"), false);
  } finally {
    await server.close();
  }
});

test("read-only repository cannot be connected", async () => {
  const service = mockService({ admin: false, maintain: false, push: false, pull: true });
  const server = await startServer(deps(service));
  try {
    const auth = await connectUser(server.baseUrl);
    const response = await fetch(`${server.baseUrl}/api/github/repositories/connect`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ repoFullName: "octocat/android-app" }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "insufficient_repository_permissions" });
    const selection = await fetch(`${server.baseUrl}/api/github/selection`, { headers: auth });
    assert.deepEqual((await selection.json()) as any, { project: null });
  } finally {
    await server.close();
  }
});

test("missing repository is reported with a safe provider code", async () => {
  const service = mockService(null, true);
  const server = await startServer(deps(service));
  try {
    const auth = await connectUser(server.baseUrl);
    const response = await fetch(`${server.baseUrl}/api/github/repositories/connect`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ repoFullName: "octocat/missing" }),
    });
    assert.equal(response.status, 404);
    const body = (await response.json()) as any;
    assert.equal(body.error, "github_request_failed");
    assert.equal(body.providerCode, "repository_not_found");
  } finally {
    await server.close();
  }
});
