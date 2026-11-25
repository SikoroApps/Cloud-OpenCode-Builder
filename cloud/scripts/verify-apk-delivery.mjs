#!/usr/bin/env node
// End-to-end verification of browser APK delivery against a real GitHub Actions artifact.
//
// Usage:
//   GITHUB_ARTIFACT_TOKEN=<token with actions:read on the repo> \
//   APK_VERIFY_RUN_ID=<workflow run id> \
//   APK_VERIFY_REPO=<owner/repo> \
//   node --experimental-strip-types --no-warnings scripts/verify-apk-delivery.mjs
//
// The token is only used in memory to seed an encrypted GitHub connection in a throwaway
// SQLite database. It is never written to the repository or printed.

import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoFullName = process.env.APK_VERIFY_REPO || "SikoroApps/Cloud-OpenCode-Builder";
const runId = Number(process.env.APK_VERIFY_RUN_ID || "0");
const githubToken = process.env.GITHUB_ARTIFACT_TOKEN || process.env.GH_TOKEN || "";
const port = Number(process.env.APK_VERIFY_PORT || "18080");

if (!githubToken) throw new Error("GITHUB_ARTIFACT_TOKEN is required");
if (!Number.isFinite(runId) || runId <= 0) throw new Error("APK_VERIFY_RUN_ID is required");

const [owner, repo] = repoFullName.split("/");
if (!owner || !repo) throw new Error("APK_VERIFY_REPO must be owner/repo");

const workDir = join(tmpdir(), `cloud-opencode-apk-verify-${randomUUID()}`);
mkdirSync(workDir, { recursive: true });
const dbPath = join(workDir, "verify.sqlite");
const apkPath = join(workDir, "app-debug.apk");

process.env.CLOUD_DB_PATH = dbPath;
process.env.CLOUD_BASE_URL = `http://127.0.0.1:${port}`;
process.env.RATE_LIMIT_ENABLED = "0";
process.env.GITHUB_CLIENT_ID = "verify-client-id";
process.env.GITHUB_CLIENT_SECRET = "verify-client-secret";
process.env.GITHUB_OAUTH_REDIRECT_URI = "https://verify.invalid/api/github/oauth/callback";
const encryptionKey = Buffer.from(process.env.GITHUB_TOKEN_ENCRYPTION_KEY_B64 || "", "base64");
const key = encryptionKey.length === 32 ? encryptionKey : Buffer.from(
  Array.from({ length: 32 }, (_, index) => (index * 7 + 11) % 256),
);
process.env.GITHUB_TOKEN_ENCRYPTION_KEY = key.toString("base64");

const { hashPassword, createUserSession } = await import("../src/auth.ts");
const db = await import("../src/db.ts");
const { encryptToken } = await import("../src/github.ts");
const { loadConfig } = await import("../src/config.ts");
const { createApiDependencies, createApiHandler } = await import("../src/http.ts");

const userId = "verify-user";
const projectId = "verify-project";
const buildId = "verify-build";
const now = Date.now();
const email = "verify@example.invalid";
const passwordSalt = "verify-salt";
const password = "verify-password";

db.insertUser(userId, email, hashPassword(password, passwordSalt), passwordSalt, now);
const session = createUserSession(userId, now);
const encrypted = encryptToken(githubToken, key);
db.saveGithubConnection({
  userId,
  githubUserId: 1,
  login: owner,
  scopes: "public_repo workflow",
  ciphertext: encrypted.ciphertext,
  iv: encrypted.iv,
  tag: encrypted.tag,
  now,
});
db.saveProject({
  id: projectId,
  userId,
  repoId: 1,
  repoFullName,
  repoOwner: owner,
  repoName: repo,
  defaultBranch: "main",
  htmlUrl: `https://github.com/${repoFullName}`,
  now,
});
db.selectProject(userId, projectId, now);
db.saveBuild({
  id: buildId,
  projectId,
  status: "completed",
  conclusion: "success",
  progress: 100,
  workflowPath: ".github/workflows/android-ci.yml",
  ref: "main",
  runId,
  runUrl: `https://github.com/${repoFullName}/actions/runs/${runId}`,
  logsUrl: null,
  error: null,
  now,
});

const handler = createApiHandler(createApiDependencies(loadConfig()));
const server = createServer((req, res) => {
  handler(req, res).catch((error) => {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "verification_server_error", message: String(error?.message || error) }));
  });
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const base = `http://127.0.0.1:${port}`;
const authHeaders = { Authorization: `Bearer ${session.token}` };
const checks = [];
function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), detail });
  if (!condition) throw new Error(`check failed: ${name}${detail ? ` (${detail})` : ""}`);
}

try {
  const artifactsResponse = await fetch(`${base}/api/projects/build/artifacts?buildId=${encodeURIComponent(buildId)}`, { headers: authHeaders });
  const artifactsBody = await artifactsResponse.json();
  check("artifacts endpoint authorized", artifactsResponse.status === 200, `status=${artifactsResponse.status}`);
  const artifact = (artifactsBody.artifacts || []).find((item) => item.name === "cloud-opencode-debug")
    || (artifactsBody.artifacts || [])[0];
  check("real APK artifact listed", Boolean(artifact), JSON.stringify(artifactsBody));
  check("artifact is not expired", artifact.expired === false, `expired=${artifact.expired}`);

  const linkResponse = await fetch(`${base}/api/projects/build/artifact/link`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ buildId, artifactId: artifact.id }),
  });
  const link = await linkResponse.json();
  check("download link created", linkResponse.status === 200, `status=${linkResponse.status} body=${JSON.stringify(link)}`);
  check("link uses public base url", String(link.url || "").startsWith(base), String(link.url));
  check("link carries one-time grant", /[?&]grant=/.test(String(link.url || "")), String(link.url));
  check("link expires in ten minutes", Number(link.expiresIn) === 600000, String(link.expiresIn));

  const noGrantResponse = await fetch(`${base}/api/projects/build/artifact?buildId=${encodeURIComponent(buildId)}&artifactId=${artifact.id}`);
  check("unauthenticated request without grant is rejected", noGrantResponse.status === 401, `status=${noGrantResponse.status}`);

  const downloadResponse = await fetch(link.url);
  if (downloadResponse.status !== 200) {
    check("browser download needs no Authorization header", false,
      `status=${downloadResponse.status} body=${JSON.stringify(await downloadResponse.text())}`);
  }
  const apkBytes = Buffer.from(await downloadResponse.arrayBuffer());
  check("browser download needs no Authorization header", true);
  check("content type is APK", downloadResponse.headers.get("content-type") === "application/vnd.android.package-archive", String(downloadResponse.headers.get("content-type")));
  check("content disposition is attachment", /attachment; filename="[^"]+\.apk"/.test(String(downloadResponse.headers.get("content-disposition"))), String(downloadResponse.headers.get("content-disposition")));
  check("content length matches body", Number(downloadResponse.headers.get("content-length")) === apkBytes.length, `${downloadResponse.headers.get("content-length")} vs ${apkBytes.length}`);
  writeFileSync(apkPath, apkBytes);
  check("downloaded file is non-empty", statSync(apkPath).size > 0, String(statSync(apkPath).size));

  const localSha256 = createHash("sha256").update(apkBytes).digest("hex");
  check("X-APK-Sha256 header matches download", downloadResponse.headers.get("x-apk-sha256") === localSha256, String(downloadResponse.headers.get("x-apk-sha256")));

  const zipListing = execFileSync("unzip", ["-l", apkPath], { encoding: "utf8" });
  check("downloaded file is a zip/APK", zipListing.includes("AndroidManifest.xml"), zipListing.split("\n").slice(0, 3).join(" | "));

  const checksumResponse = await fetch(`${base}/api/projects/build/artifact/checksum?buildId=${encodeURIComponent(buildId)}&artifactId=${artifact.id}`, { headers: authHeaders });
  const checksum = await checksumResponse.json();
  check("checksum endpoint returns data", checksumResponse.status === 200, `status=${checksumResponse.status} body=${JSON.stringify(checksum)}`);
  check("checksum sha256 matches download", checksum.sha256 === localSha256, `${checksum.sha256} vs ${localSha256}`);
  check("checksum size matches download", Number(checksum.sizeInBytes) === apkBytes.length, `${checksum.sizeInBytes} vs ${apkBytes.length}`);
  check("checksum filename is an apk", /\.apk$/i.test(String(checksum.filename)), String(checksum.filename));

  const replayResponse = await fetch(link.url);
  check("download grant is single use", replayResponse.status === 403, `status=${replayResponse.status}`);

  console.log(JSON.stringify({
    verified: true,
    repository: repoFullName,
    runId,
    artifact: { id: artifact.id, name: artifact.name, sizeInBytes: artifact.sizeInBytes },
    download: {
      filename: checksum.filename,
      sizeInBytes: apkBytes.length,
      sha256: localSha256,
      contentType: downloadResponse.headers.get("content-type"),
      contentDisposition: downloadResponse.headers.get("content-disposition"),
      authorizationHeaderRequired: false,
      singleUseGrant: true,
    },
    checks,
    apkPath,
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.closeDb();
  if (process.env.APK_VERIFY_CLEAN === "1") rmSync(workDir, { recursive: true, force: true });
}
