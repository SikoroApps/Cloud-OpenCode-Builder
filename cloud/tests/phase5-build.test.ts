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

process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-phase5-build-")), "test.sqlite");

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

function mockService(outcome: "success" | "failure"): GithubService {
  let dispatched = false;
  let run: any = null;
  let jobs: any[] = [];
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
      return [];
    },
    async getRepository() {
      throw new GithubServiceError("repository_not_found", 404);
    },
    async repositoryExists() {
      return false;
    },
    async createRepository(_token: string, input: { name: string }) {
      return {
        id: 3,
        fullName: `octocat/${input.name}`,
        name: input.name,
        owner: "octocat",
        isPrivate: false,
        defaultBranch: "main",
        htmlUrl: `https://github.com/octocat/${input.name}`,
        permissions: { admin: true, maintain: true, push: true, pull: true },
      };
    },
    async getFile() {
      return null;
    },
    async upsertFile() {
      throw new Error("not used");
    },
    async dispatchWorkflow() {
      dispatched = true;
      const now = Date.now();
      run = {
        id: 321,
        status: "in_progress",
        conclusion: null,
        createdAt: now,
        updatedAt: now,
        htmlUrl: "https://github.com/octocat/build-app/actions/runs/321",
        headBranch: "main",
        event: "workflow_dispatch",
      };
      jobs = [{
        id: 1,
        name: "build",
        status: "in_progress",
        conclusion: null,
        steps: [{ name: "Assemble", status: "in_progress", conclusion: null }],
      }];
    },
    async listWorkflowRuns() {
      return dispatched ? [run] : [];
    },
    async getWorkflowRun() {
      if (!run) throw new GithubServiceError("workflow_run_failed", 404);
      const now = Date.now();
      run = {
        ...run,
        status: "completed",
        conclusion: outcome,
        updatedAt: now,
      };
      jobs = [{
        id: 1,
        name: "build",
        status: "completed",
        conclusion: outcome,
        steps: [{ name: "Assemble", status: "completed", conclusion: outcome }],
      }];
      return run;
    },
    async listWorkflowJobs() {
      if (!run) throw new GithubServiceError("workflow_jobs_failed", 404);
      return jobs;
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

async function prepareBuild(baseUrl: string): Promise<{ auth: Record<string, string>; buildId: string }> {
  const registered = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `build-${Date.now()}-${randomBytes(4).toString("hex")}@example.invalid`,
      password: "password-1234",
    }),
  });
  assert.equal(registered.status, 201);
  const auth = { Authorization: `Bearer ${String(((await registered.json()) as any).token)}` };
  const start = await fetch(`${baseUrl}/api/github/oauth/start`, { headers: auth });
  const state = new URL(String(((await start.json()) as any).authorizationUrl)).searchParams.get("state") || "";
  const callback = await fetch(`${baseUrl}/api/github/oauth/callback?code=abc&state=${state}`, { redirect: "manual" });
  assert.equal(new URL(callback.headers.get("location") || "").searchParams.get("status"), "connected");

  const create = await fetch(`${baseUrl}/api/github/repositories`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "build-app", description: "phase 5 build test" }),
  });
  assert.equal(create.status, 201);

  const dispatch = await fetch(`${baseUrl}/api/projects/builds`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ workflowPath: ".github/workflows/android-build.yml", ref: "main" }),
  });
  assert.equal(dispatch.status, 201);
  return { auth, buildId: String(((await dispatch.json()) as any).build.id) };
}

async function verification(baseUrl: string, auth: Record<string, string>, buildId: string): Promise<any> {
  const response = await fetch(`${baseUrl}/api/projects/build/verification?buildId=${encodeURIComponent(buildId)}`, { headers: auth });
  assert.equal(response.status, 200);
  return response.json();
}

test("dispatch acceptance alone is never reported as a verified build", async () => {
  const server = await startServer(deps(mockService("success")));
  try {
    const { auth, buildId } = await prepareBuild(server.baseUrl);
    const report = await verification(server.baseUrl, auth, buildId);
    assert.equal(report.verified, false);
    assert.equal(report.reason, "dispatch_only");
    assert.equal(report.status, "queued");
  } finally {
    await server.close();
  }
});

test("a completed successful dispatch run with all jobs complete is verified", async () => {
  const server = await startServer(deps(mockService("success")));
  try {
    const { auth, buildId } = await prepareBuild(server.baseUrl);
    const refresh = await fetch(`${server.baseUrl}/api/projects/build/refresh`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    assert.equal(refresh.status, 200);

    const report = await verification(server.baseUrl, auth, buildId);
    assert.equal(report.runId, 321);
    assert.equal(report.status, "completed");
    assert.equal(report.conclusion, "success");
    assert.equal(report.dispatchMatches, true);
    assert.equal(report.allJobsCompleted, true);
    assert.equal(report.failedSteps.length, 0);
    assert.equal(report.verified, true);
  } finally {
    await server.close();
  }
});

test("a failed run is not verified and its failed step is reported", async () => {
  const server = await startServer(deps(mockService("failure")));
  try {
    const { auth, buildId } = await prepareBuild(server.baseUrl);
    const refresh = await fetch(`${server.baseUrl}/api/projects/build/refresh`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    assert.equal(refresh.status, 200);

    const report = await verification(server.baseUrl, auth, buildId);
    assert.equal(report.conclusion, "failure");
    assert.equal(report.verified, false);
    assert.deepEqual(report.failedSteps, [{ job: "build", step: "Assemble" }]);
  } finally {
    await server.close();
  }
});
