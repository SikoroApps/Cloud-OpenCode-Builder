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
import { GithubServiceError, type GithubService } from "../src/github.ts";
import type { AiFilePlanner } from "../src/files.ts";
import { makeStoredZip } from "./test-zip.ts";

process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-phase5-apk-")), "test.sqlite");

const apkBytes = Buffer.from("signed-release-apk-bytes-for-tests");
const apkSha256 = createHash("sha256").update(apkBytes).digest("hex");

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

function evidenceText(checksum = apkSha256): string {
  return [
    "=== apksigner verify --verbose --print-certs ===",
    "Verifies",
    "Verified using v2 scheme (APK Signature Scheme v2): true",
    "=== aapt dump badging ===",
    "package: name='com.sikorokoro44.cloudopencode' versionCode='1' versionName='0.1.0'",
    "native-code: 'arm64-v8a' 'armeabi-v7a'",
    "=== sha256sum ===",
    `${checksum}  app-release.apk`,
  ].join("\n");
}

function mockService(options: { withEvidence?: boolean; checksum?: string } = {}): GithubService {
  let run: any = null;
  const apkZip = makeStoredZip([{
    name: "app/build/outputs/apk/release/app-release.apk",
    content: apkBytes,
  }]);
  const evidenceZip = makeStoredZip([{
    name: "apk-release-evidence.txt",
    content: evidenceText(options.checksum),
  }]);
  const artifacts = [
    {
      id: 11,
      name: "app-release-signed",
      sizeInBytes: apkZip.length,
      expired: false,
      createdAt: Date.now(),
      htmlUrl: "https://github.com/octocat/apk-app/actions/runs/11/artifacts/11",
    },
    ...(options.withEvidence === false ? [] : [{
      id: 12,
      name: "app-release-signed-evidence",
      sizeInBytes: evidenceZip.length,
      expired: false,
      createdAt: Date.now(),
      htmlUrl: "https://github.com/octocat/apk-app/actions/runs/11/artifacts/12",
    }]),
  ];
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
        id: 5,
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
      const now = Date.now();
      run = {
        id: 11,
        status: "in_progress",
        conclusion: null,
        createdAt: now,
        updatedAt: now,
        htmlUrl: "https://github.com/octocat/apk-app/actions/runs/11",
        headBranch: "main",
        event: "workflow_dispatch",
      };
    },
    async listWorkflowRuns() {
      return run ? [run] : [];
    },
    async getWorkflowRun() {
      if (!run) throw new GithubServiceError("workflow_run_failed", 404);
      run = { ...run, status: "completed", conclusion: "success" };
      return run;
    },
    async listWorkflowJobs() {
      if (!run) throw new GithubServiceError("workflow_jobs_failed", 404);
      return [{ id: 1, name: "release", status: "completed", conclusion: "success", steps: [] }];
    },
    async listWorkflowArtifacts() {
      return artifacts;
    },
    async downloadWorkflowArtifact(_token: string, input: { artifactId: number }) {
      if (input.artifactId === 11) return { bytes: apkZip, suggestedFilename: "app-release-signed.zip" };
      if (input.artifactId === 12) return { bytes: evidenceZip, suggestedFilename: "app-release-signed-evidence.zip" };
      throw new GithubServiceError("workflow_artifact_download_failed", 404);
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

async function successfulBuild(baseUrl: string): Promise<{ auth: Record<string, string>; buildId: string }> {
  const registered = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `apk-${Date.now()}-${randomBytes(4).toString("hex")}@example.invalid`,
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
    body: JSON.stringify({ name: "apk-app", description: "phase 5 APK test" }),
  });
  assert.equal(create.status, 201);
  const dispatch = await fetch(`${baseUrl}/api/projects/builds`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ workflowPath: ".github/workflows/android-release.yml", ref: "main" }),
  });
  assert.equal(dispatch.status, 201);
  const buildId = String(((await dispatch.json()) as any).build.id);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const refresh = await fetch(`${baseUrl}/api/projects/build/refresh`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    assert.equal(refresh.status, 200);
  }
  return { auth, buildId };
}

test("signed APK verification reports real signature, checksum and badging evidence", async () => {
  const server = await startServer(deps(mockService()));
  try {
    const { auth, buildId } = await successfulBuild(server.baseUrl);
    const response = await fetch(
      `${server.baseUrl}/api/projects/build/apk-verification?buildId=${encodeURIComponent(buildId)}&artifactId=11`,
      { headers: auth },
    );
    assert.equal(response.status, 200);
    const report = (await response.json()) as any;
    assert.equal(report.verified, true);
    assert.equal(report.signatureVerified, true);
    assert.equal(report.checksumMatches, true);
    assert.equal(report.sha256, apkSha256);
    assert.equal(report.packageName, "com.sikorokoro44.cloudopencode");
    assert.equal(report.versionName, "0.1.0");
    assert.deepEqual(report.supportedArchitectures, ["arm64-v8a", "armeabi-v7a"]);
  } finally {
    await server.close();
  }
});

test("checksum mismatch in evidence fails APK verification", async () => {
  const server = await startServer(deps(mockService({ checksum: "f".repeat(64) })));
  try {
    const { auth, buildId } = await successfulBuild(server.baseUrl);
    const response = await fetch(
      `${server.baseUrl}/api/projects/build/apk-verification?buildId=${encodeURIComponent(buildId)}&artifactId=11`,
      { headers: auth },
    );
    assert.equal(response.status, 200);
    const report = (await response.json()) as any;
    assert.equal(report.checksumMatches, false);
    assert.equal(report.verified, false);
  } finally {
    await server.close();
  }
});

test("missing evidence artifact blocks APK verification", async () => {
  const server = await startServer(deps(mockService({ withEvidence: false })));
  try {
    const { auth, buildId } = await successfulBuild(server.baseUrl);
    const response = await fetch(
      `${server.baseUrl}/api/projects/build/apk-verification?buildId=${encodeURIComponent(buildId)}&artifactId=11`,
      { headers: auth },
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "evidence_artifact_not_found" });
  } finally {
    await server.close();
  }
});
