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
import { makeStoredZip } from "./test-zip.ts";

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

function mockService(options: { failCommit?: boolean; buildOutcome?: "success" | "failure"; withArtifact?: boolean } = {}): GithubService {
  const files = new Map<string, string>([["README.md", "# existing-app"]]);
  let commitCount = 0;
  let dispatched = false;
  let runViews = 0;
  let run: any = null;
  let jobs: any[] = [];
  const artifactZip = makeStoredZip([{
    name: "app/build/outputs/apk/debug/app-debug.apk",
    content: "APK-BYTES-FOR-DOWNLOAD",
  }]);
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
    async dispatchWorkflow() {
      dispatched = true;
      const now = Date.now();
      run = {
        id: 99,
        status: "in_progress",
        conclusion: null,
        createdAt: now,
        updatedAt: now,
        htmlUrl: "https://github.com/octocat/new-app/actions/runs/99",
        headBranch: "main",
        event: "workflow_dispatch",
      };
      jobs = [{
        id: 7,
        name: "build",
        status: "in_progress",
        conclusion: null,
        steps: [
          { name: "Checkout", status: "completed", conclusion: "success" },
          { name: "Assemble", status: "in_progress", conclusion: null },
        ],
      }];
    },
    async listWorkflowRuns() {
      if (!dispatched) return [];
      return [run];
    },
    async getWorkflowRun() {
      if (!run) throw new GithubServiceError("workflow_run_failed", 404);
      runViews += 1;
      if (runViews >= 1) {
        const conclusion = options.buildOutcome === "failure" ? "failure" : "success";
        run = { ...run, status: "completed", conclusion };
        jobs = [{
          id: 7,
          name: "build",
          status: "completed",
          conclusion,
          steps: [
            { name: "Checkout", status: "completed", conclusion: "success" },
            { name: "Assemble", status: "completed", conclusion },
          ],
        }];
      }
      return run;
    },
    async listWorkflowJobs() {
      if (!run) throw new GithubServiceError("workflow_jobs_failed", 404);
      return jobs;
    },
    async listWorkflowArtifacts() {
      if (!options.withArtifact) return [];
      return [{
        id: 7,
        name: "app-debug-apk",
        sizeInBytes: artifactZip.length,
        expired: false,
        createdAt: Date.now(),
        htmlUrl: "https://github.com/octocat/new-app/actions/runs/99/artifacts/7",
      }];
    },
    async downloadWorkflowArtifact() {
      return { bytes: artifactZip, suggestedFilename: "app-debug-apk.zip" };
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

test("build dispatch only reports success after a successful GitHub workflow result", async () => {
  const server = await startServer(deps(true, mockService({ buildOutcome: "success" })));
  try {
    const auth = await registerAndConnect(server.baseUrl);
    await createProject(server.baseUrl, auth);

    let response = await fetch(`${server.baseUrl}/api/projects/build-workflow`, {
      method: "POST",
      headers: auth,
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).file.path, ".github/workflows/android-build.yml");

    response = await fetch(`${server.baseUrl}/api/projects/builds`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 201);
    let build = ((await response.json()) as any).build;
    assert.equal(build.status, "queued");
    assert.equal(build.runId, null);
    assert.equal(JSON.stringify(build).includes("gh-token-do-not-expose"), false);
    const buildId = String(build.id);

    response = await fetch(`${server.baseUrl}/api/projects/build/refresh`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    assert.equal(response.status, 200);
    build = ((await response.json()) as any).build;
    assert.equal(build.status, "in_progress");
    assert.equal(build.runId, 99);
    assert.equal(build.conclusion, null);

    response = await fetch(`${server.baseUrl}/api/projects/build/logs?buildId=${buildId}`, { headers: auth });
    assert.equal(response.status, 200);
    const logs = (await response.json()) as any;
    assert.equal(logs.runId, 99);
    assert.equal(logs.jobs[0].name, "build");
    assert.equal(logs.failedSteps.length, 0);

    response = await fetch(`${server.baseUrl}/api/projects/build/refresh`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    build = ((await response.json()) as any).build;
    assert.equal(build.status, "completed");
    assert.equal(build.conclusion, "success");
    assert.equal(build.progress, 100);
    assert.equal(build.error, null);

    response = await fetch(`${server.baseUrl}/api/projects/builds`, { headers: auth });
    const builds = ((await response.json()) as any).builds as any[];
    assert.equal(builds[0].conclusion, "success");
    assert.equal(JSON.stringify(builds).includes("gh-token-do-not-expose"), false);
  } finally {
    await server.close();
    closeDb();
  }
});

test("failed GitHub workflow is reported as a failure with failed steps", async () => {
  const server = await startServer(deps(true, mockService({ buildOutcome: "failure" })));
  try {
    const auth = await registerAndConnect(server.baseUrl);
    await createProject(server.baseUrl, auth);
    let response = await fetch(`${server.baseUrl}/api/projects/builds`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 201);
    const buildId = String(((await response.json()) as any).build.id);

    response = await fetch(`${server.baseUrl}/api/projects/build/refresh`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    assert.equal(((await response.json()) as any).build.status, "in_progress");

    response = await fetch(`${server.baseUrl}/api/projects/build/refresh`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    const build = ((await response.json()) as any).build;
    assert.equal(build.status, "completed");
    assert.equal(build.conclusion, "failure");
    assert.equal(build.error, "build_failure");

    response = await fetch(`${server.baseUrl}/api/projects/build/logs?buildId=${buildId}`, { headers: auth });
    const logs = (await response.json()) as any;
    assert.equal(logs.conclusion, "failure");
    assert.equal(logs.failedSteps[0].step, "Assemble");
    assert.equal(JSON.stringify(logs).includes("gh-token-do-not-expose"), false);
  } finally {
    await server.close();
    closeDb();
  }
});

test("successful builds expose artifacts as browser-downloadable APK files", async () => {
  const server = await startServer(deps(true, mockService({ withArtifact: true })));
  try {
    const auth = await registerAndConnect(server.baseUrl);
    await createProject(server.baseUrl, auth);
    let response = await fetch(`${server.baseUrl}/api/projects/builds`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const buildId = String(((await response.json()) as any).build.id);

    response = await fetch(`${server.baseUrl}/api/projects/build/artifacts?buildId=${buildId}`, { headers: auth });
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as any).error, "build_not_successful");

    response = await fetch(`${server.baseUrl}/api/projects/build/refresh`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    assert.equal(((await response.json()) as any).build.status, "in_progress");
    response = await fetch(`${server.baseUrl}/api/projects/build/refresh`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    assert.equal(((await response.json()) as any).build.conclusion, "success");

    response = await fetch(`${server.baseUrl}/api/projects/build/artifacts?buildId=${buildId}`, { headers: auth });
    assert.equal(response.status, 200);
    const artifacts = ((await response.json()) as any).artifacts as any[];
    assert.equal(artifacts[0].name, "app-debug-apk");
    assert.equal(artifacts[0].downloadUrl.includes(encodeURIComponent(buildId)), true);
    assert.equal(artifacts[0].browserUrl, "https://github.com/octocat/new-app/actions/runs/99/artifacts/7");
    assert.equal(JSON.stringify(artifacts).includes("gh-token-do-not-expose"), false);

    response = await fetch(`${server.baseUrl}${artifacts[0].downloadUrl}`, { headers: auth });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/vnd.android.package-archive");
    assert.match(response.headers.get("content-disposition") || "", /attachment; filename="app-debug\.apk"/);
    assert.equal(await response.text(), "APK-BYTES-FOR-DOWNLOAD");
  } finally {
    await server.close();
    closeDb();
  }
});

test("browser APK link is short-lived and needs no token in the URL", async () => {
  const server = await startServer({ ...deps(true, mockService({ withArtifact: true })), publicBaseUrl: "https://backend.example.invalid" });
  try {
    const auth = await registerAndConnect(server.baseUrl);
    await createProject(server.baseUrl, auth);
    let response = await fetch(`${server.baseUrl}/api/projects/builds`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const buildId = String(((await response.json()) as any).build.id);
    for (let index = 0; index < 2; index += 1) {
      response = await fetch(`${server.baseUrl}/api/projects/build/refresh`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ buildId }),
      });
    }
    assert.equal(((await response.json()) as any).build.conclusion, "success");

    response = await fetch(`${server.baseUrl}/api/projects/build/artifact/link`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId, artifactId: 7 }),
    });
    assert.equal(response.status, 200);
    const link = (await response.json()) as any;
    assert.equal(link.url.startsWith("https://backend.example.invalid/api/projects/build/artifact?"), true);
    assert.equal(link.downloadUrl.includes("grant="), true);
    assert.equal(link.expiresIn, 600_000);
    assert.equal(JSON.stringify(link).includes("gh-token-do-not-expose"), false);

    const browserResponse = await fetch(link.url.replace("https://backend.example.invalid", server.baseUrl));
    assert.equal(browserResponse.status, 200);
    assert.equal(await browserResponse.text(), "APK-BYTES-FOR-DOWNLOAD");

    const replay = await fetch(link.url.replace("https://backend.example.invalid", server.baseUrl));
    assert.equal(replay.status, 403);
    assert.equal(((await replay.json()) as any).error, "invalid_download_grant");
  } finally {
    await server.close();
    closeDb();
  }
});

test("configuration readiness endpoint returns masked checks only", async () => {
  const server = await startServer({
    ...deps(),
    readinessCloud: {
      baseUrl: "https://backend.example.invalid",
      openRouterApiKeySet: true,
      openCodeApiKeySet: false,
    },
  });
  try {
    const auth = await registerAndConnect(server.baseUrl);
    const response = await fetch(`${server.baseUrl}/api/config/readiness`, { headers: auth });
    assert.equal(response.status, 200);
    const body = await response.text();
    const parsed = JSON.parse(body) as any;
    assert.equal(parsed.readiness.githubOAuth.configured, true);
    assert.equal(parsed.readiness.readyForLiveOAuth, true);
    assert.equal(body.includes("client-secret"), false);
    assert.equal(body.includes("gh-token-do-not-expose"), false);
    assert.equal(body.includes("backend.example.invalid"), false);
  } finally {
    await server.close();
    closeDb();
  }
});

test("launcher icon and signed release templates never include signing values", async () => {
  const server = await startServer(deps());
  try {
    const auth = await registerAndConnect(server.baseUrl);
    await createProject(server.baseUrl, auth);

    let response = await fetch(`${server.baseUrl}/api/projects/launcher-icon`, { method: "POST", headers: auth });
    assert.equal(response.status, 200);
    const iconFiles = ((await response.json()) as any).files as string[];
    assert.equal(iconFiles.includes("app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml"), true);
    response = await fetch(`${server.baseUrl}/api/projects/files`, { headers: auth });
    const files = ((await response.json()) as any).files as any[];
    assert.equal(files.some((file) => file.path.endsWith("ic_launcher_foreground.xml") && file.content.includes("vector")), true);

    response = await fetch(`${server.baseUrl}/api/projects/signed-release-workflow`, { method: "POST", headers: auth });
    assert.equal(response.status, 200);
    const workflow = (await response.json()) as any;
    assert.deepEqual(workflow.requiredSecrets, [
      "ANDROID_KEYSTORE_BASE64",
      "ANDROID_KEYSTORE_PASSWORD",
      "ANDROID_KEY_ALIAS",
      "ANDROID_KEY_PASSWORD",
    ]);
    assert.equal(workflow.file.content.includes("${{ secrets.ANDROID_KEYSTORE_BASE64 }}"), true);
    assert.equal(workflow.file.content.includes("app/release.jks"), true);
    response = await fetch(`${server.baseUrl}/api/projects/file?path=.gitignore`, { headers: auth });
    assert.equal(((await response.json()) as any).file.content.includes("*.jks"), true);
    assert.equal(/gh-token-do-not-expose|client-secret|BEGIN PRIVATE KEY/.test(JSON.stringify(workflow)), false);
  } finally {
    await server.close();
    closeDb();
  }
});
