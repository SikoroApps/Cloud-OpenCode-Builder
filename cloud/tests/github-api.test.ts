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
import { closeDb } from "../src/db.ts";

process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-github-api-")), "test.sqlite");

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

function mockService(options: { failCommit?: boolean } = {}): GithubService {
  const files = new Map<string, string>([["README.md", "# existing-app"]]);
  let commitCount = 0;
  const repositories = [{
    id: 1,
    fullName: "octocat/existing-app",
    name: "existing-app",
    owner: "octocat",
    isPrivate: false,
    defaultBranch: "main",
    htmlUrl: "https://github.com/octocat/existing-app",
  }];
  return {
    authorizationUrl(state: string) {
      return `https://github.com/login/oauth/authorize?state=${encodeURIComponent(state)}`;
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
      return [...repositories];
    },
    async repositoryExists(_token: string, owner: string, name: string) {
      return repositories.some((repo) => repo.owner === owner && repo.name === name);
    },
    async createRepository(_token: string, input: { name: string; description: string }) {
      const repo = {
        id: repositories.length + 1,
        fullName: `octocat/${input.name}`,
        name: input.name,
        owner: "octocat",
        isPrivate: false,
        defaultBranch: "main",
        htmlUrl: `https://github.com/octocat/${input.name}`,
      };
      repositories.push(repo);
      return repo;
    },
    async getFile(_token: string, input: { path: string }) {
      const content = files.get(input.path);
      return content === undefined ? null : { path: input.path, sha: `sha-${input.path}`, content };
    },
    async upsertFile(_token: string, input: { path: string; content: string }) {
      if (options.failCommit) throw new GithubServiceError("file_commit_failed", 403);
      commitCount += 1;
      files.set(input.path, input.content);
      const sha = `commit-${commitCount}-${input.path.replace(/[^A-Za-z0-9_-]/g, "-")}`;
      return { sha, htmlUrl: `https://github.com/octocat/new-app/commit/${sha}` };
    },
  };
}

function mockAiPlanner(): AiFilePlanner {
  return async ({ instruction }) => ({
    model: "mock/file-planner",
    operations: [{
      path: "app/src/main/Generated.kt",
      content: `// ${instruction}\nclass Generated\n`,
    }],
  });
}

function deps(configured = true, service: GithubService = mockService()): ApiDependencies {
  return {
    githubConfig: githubConfig(configured),
    githubService: service,
    aiFilePlanner: mockAiPlanner(),
  };
}

async function registerAndConnect(baseUrl: string): Promise<Record<string, string>> {
  const registered = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `files-${Date.now()}-${randomBytes(4).toString("hex")}@example.invalid`,
      password: "password-1234",
    }),
  });
  assert.equal(registered.status, 201);
  const token = String(((await registered.json()) as any).token);
  const auth = { Authorization: `Bearer ${token}` };
  const start = await fetch(`${baseUrl}/api/github/oauth/start`, { headers: auth });
  assert.equal(start.status, 200);
  const state = new URL(((await start.json()) as any).authorizationUrl).searchParams.get("state") || "";
  const callback = await fetch(`${baseUrl}/api/github/oauth/callback?code=abc&state=${state}`, { redirect: "manual" });
  assert.equal(new URL(callback.headers.get("location") || "").searchParams.get("status"), "connected");
  return auth;
}

async function createProject(baseUrl: string, auth: Record<string, string>): Promise<void> {
  const response = await fetch(`${baseUrl}/api/github/repositories`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "new-app", description: "created by Cloud OpenCode" }),
  });
  assert.equal(response.status, 201);
}

async function startServer(deps: ApiDependencies): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer(createApiHandler(deps));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("GitHub OAuth connect, status and disconnect never expose the token", async () => {
  const server = await startServer(deps());
  try {
    const registered = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `github-${Date.now()}@example.invalid`, password: "password-1234" }),
    });
    assert.equal(registered.status, 201);
    const token = String(((await registered.json()) as any).token);
    const auth = { Authorization: `Bearer ${token}` };

    let response = await fetch(`${server.baseUrl}/api/github/status`, { headers: auth });
    assert.equal(response.status, 200);
    let status = (await response.json()) as any;
    assert.equal(status.configured, true);
    assert.equal(status.connected, false);

    response = await fetch(`${server.baseUrl}/api/github/oauth/start`, { headers: auth });
    assert.equal(response.status, 200);
    const start = (await response.json()) as any;
    const state = new URL(start.authorizationUrl).searchParams.get("state") || "";
    assert.equal(state.length, 64);

    response = await fetch(`${server.baseUrl}/api/github/oauth/callback?code=abc&state=${state}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const location = response.headers.get("location") || "";
    assert.equal(new URL(location).searchParams.get("status"), "connected");
    assert.equal(location.includes("gh-token-do-not-expose"), false);

    response = await fetch(`${server.baseUrl}/api/github/status`, { headers: auth });
    status = (await response.json()) as any;
    assert.equal(status.connected, true);
    assert.equal(status.login, "octocat");
    assert.equal(JSON.stringify(status).includes("gh-token-do-not-expose"), false);

    response = await fetch(`${server.baseUrl}/api/github/repositories`, { headers: auth });
    assert.equal(response.status, 200);
    const repositories = ((await response.json()) as any).repositories as any[];
    assert.equal(repositories.length, 1);
    assert.equal(repositories[0].fullName, "octocat/existing-app");
    assert.equal(JSON.stringify(repositories).includes("gh-token-do-not-expose"), false);

    response = await fetch(`${server.baseUrl}/api/github/repositories`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-app", description: "created by Cloud OpenCode" }),
    });
    assert.equal(response.status, 201);
    const created = (await response.json()) as any;
    assert.equal(created.repository.fullName, "octocat/new-app");
    assert.equal(created.repository.isPrivate, false);
    assert.equal(created.project.repoFullName, "octocat/new-app");

    response = await fetch(`${server.baseUrl}/api/github/repositories`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-app" }),
    });
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as any).error, "repository_exists");

    response = await fetch(`${server.baseUrl}/api/github/selection`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ repoFullName: "octocat/new-app" }),
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).project.repoFullName, "octocat/new-app");

    response = await fetch(`${server.baseUrl}/api/github/selection`, { headers: auth });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).project.repoFullName, "octocat/new-app");

    response = await fetch(`${server.baseUrl}/api/github/oauth/callback?code=abc&state=${state}`, { redirect: "manual" });
    assert.equal(new URL(response.headers.get("location") || "").searchParams.get("error"), "invalid_state");

    response = await fetch(`${server.baseUrl}/api/github`, { method: "DELETE", headers: auth });
    assert.equal(response.status, 200);
    const disconnect = (await response.json()) as any;
    assert.equal(disconnect.disconnected, true);
    assert.equal(disconnect.revoked, true);

    response = await fetch(`${server.baseUrl}/api/github/status`, { headers: auth });
    status = (await response.json()) as any;
    assert.equal(status.connected, false);
  } finally {
    await server.close();
    closeDb();
  }
});

test("GitHub endpoints report missing configuration without generated credentials", async () => {
  const server = await startServer(deps(false));
  try {
    const registered = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `unconfigured-${Date.now()}@example.invalid`, password: "password-1234" }),
    });
    const token = String(((await registered.json()) as any).token);
    let response = await fetch(`${server.baseUrl}/api/github/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = (await response.json()) as any;
    assert.equal(status.configured, false);
    assert.equal(status.connected, false);

    response = await fetch(`${server.baseUrl}/api/github/oauth/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as any).error, "github_not_configured");
  } finally {
    await server.close();
    closeDb();
  }
});

test("AI file editing and commit status work without exposing the GitHub token", async () => {
  const server = await startServer(deps());
  try {
    const auth = await registerAndConnect(server.baseUrl);
    await createProject(server.baseUrl, auth);

    let response = await fetch(`${server.baseUrl}/api/projects/files`, { headers: auth });
    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as any).files, []);

    response = await fetch(`${server.baseUrl}/api/projects/files`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "README.md", content: "# new-app" }),
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).file.dirty, true);

    response = await fetch(`${server.baseUrl}/api/projects/files`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "../secret.md", content: "no" }),
    });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as any).error, "invalid_file_path");

    response = await fetch(`${server.baseUrl}/api/projects/files`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "app/src/main/sketch.bin", content: "no" }),
    });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as any).error, "unsupported_file_type");

    response = await fetch(`${server.baseUrl}/api/projects/ai-files`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "add greeting" }),
    });
    assert.equal(response.status, 200);
    const aiPlan = (await response.json()) as any;
    assert.equal(aiPlan.model, "mock/file-planner");
    assert.deepEqual(aiPlan.applied, ["app/src/main/Generated.kt"]);

    response = await fetch(`${server.baseUrl}/api/projects/file?path=app%2Fsrc%2Fmain%2FGenerated.kt`, { headers: auth });
    assert.equal(response.status, 200);
    assert.match(((await response.json()) as any).file.content, /add greeting/);

    response = await fetch(`${server.baseUrl}/api/projects/commit`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "apply AI edits" }),
    });
    assert.equal(response.status, 200);
    const commit = (await response.json()) as any;
    assert.equal(commit.status, "success");
    assert.equal(commit.files.length, 2);
    assert.equal(typeof commit.files[0].sha, "string");
    assert.equal(JSON.stringify(commit).includes("gh-token-do-not-expose"), false);

    response = await fetch(`${server.baseUrl}/api/projects/files`, { headers: auth });
    const files = ((await response.json()) as any).files as any[];
    assert.equal(files.every((file) => file.dirty === false), true);

    response = await fetch(`${server.baseUrl}/api/projects/commit`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "nothing to commit" }),
    });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as any).error, "no_changes");

    response = await fetch(`${server.baseUrl}/api/projects/commits`, { headers: auth });
    const commits = ((await response.json()) as any).commits as any[];
    assert.equal(commits[0].status, "failed");
    assert.equal(commits[0].error, "no_changes");
    assert.equal(commits[1].status, "success");
    assert.equal(commits[1].message, "apply AI edits");
    assert.equal(JSON.stringify(commits).includes("gh-token-do-not-expose"), false);
  } finally {
    await server.close();
    closeDb();
  }
});

test("failed GitHub commit records the accurate provider error", async () => {
  const server = await startServer(deps(true, mockService({ failCommit: true })));
  try {
    const auth = await registerAndConnect(server.baseUrl);
    await createProject(server.baseUrl, auth);
    let response = await fetch(`${server.baseUrl}/api/projects/files`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "README.md", content: "# changed" }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${server.baseUrl}/api/projects/commit`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "will fail" }),
    });
    assert.equal(response.status, 403);
    const error = (await response.json()) as any;
    assert.equal(error.error, "github_request_failed");
    assert.equal(error.providerCode, "file_commit_failed");
    assert.equal(JSON.stringify(error).includes("gh-token-do-not-expose"), false);

    response = await fetch(`${server.baseUrl}/api/projects/commits`, { headers: auth });
    const commits = ((await response.json()) as any).commits as any[];
    assert.equal(commits[0].status, "failed");
    assert.equal(commits[0].error, "file_commit_failed");
  } finally {
    await server.close();
    closeDb();
  }
});
