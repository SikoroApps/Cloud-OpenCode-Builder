import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FALLBACK_CHAIN } from "../src/ai.ts";

const repoRoot = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repoRoot), "utf8");
const script = (path: string) => new URL(path, import.meta.url);

function run(nodeScript: URL, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [nodeScript.pathname, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("the five-model fallback order is unchanged in Phase 9", () => {
  assert.deepEqual(FALLBACK_CHAIN.map((candidate) => candidate.id), [
    "opencode/big-pickle",
    "opencode/deepseek-v4.1-flash-free",
    "opencode/flint-40b-free",
    "openrouter/baidu/ernie-5.5-flash-preview:free",
    "openrouter/google/gemma-4-26b-a4b-it:free",
  ]);
});

test("encryption key generator emits one 32-byte base64 key and a storage warning", () => {
  const result = run(script("../scripts/generate-encryption-key.mjs"));
  assert.equal(result.status, 0);
  const key = result.stdout.trim();
  assert.equal(Buffer.from(key, "base64").length, 32);
  assert.equal(result.stderr.includes("Never commit it"), true);
  assert.equal(result.stdout.trim().split(/\s+/).length, 1);
});

test("AI verifier reports BLOCKED with the exact chain when no provider keys exist", () => {
  const result = run(script("../scripts/verify-ai.mjs"), [], {
    OPENCODE_API_KEY: "",
    OPENROUTER_API_KEY: "",
    CLOUD_AI_STUB: "1",
  });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.verified, false);
  assert.deepEqual(report.blockers, ["no AI provider key is configured"]);
  assert.deepEqual(report.chain, FALLBACK_CHAIN.map((candidate) => candidate.id));
  assert.equal(result.stdout.includes("STUB:"), false);
  assert.equal(result.stdout.includes("api-key"), false);
});

test("AI verifier --require-live exits non-zero when providers are unavailable", () => {
  const result = run(script("../scripts/verify-ai.mjs"), ["--require-live"], {
    OPENCODE_API_KEY: "",
    OPENROUTER_API_KEY: "",
  });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, "BLOCKED");
});

test("production readiness workflow runs masked checks and no secret values", () => {
  const workflow = read(".github/workflows/production-readiness.yml");
  for (const command of ["npm test", "npm run check:config", "npm run check:deployment", "npm run check:deploy-files"]) {
    assert.equal(workflow.includes(command), true);
  }
  assert.equal(/sk-[A-Za-z0-9]{10,}/.test(workflow), false);
  assert.equal(workflow.includes("ANDROID_KEYSTORE_BASE64:"), false);
});

test("live AI workflow injects secrets by reference only", () => {
  const workflow = read(".github/workflows/live-ai-verification.yml");
  assert.equal(workflow.includes("${{ secrets.OPENCODE_API_KEY }}"), true);
  assert.equal(workflow.includes("${{ secrets.OPENROUTER_API_KEY }}"), true);
  assert.equal(workflow.includes("npm run verify:ai"), true);
  assert.equal(/sk-[A-Za-z0-9]{10,}/.test(workflow), false);
  assert.equal(workflow.includes("Authorization"), false);
});

test("release readiness script reports blockers without printing values", () => {
  const result = run(script("../scripts/check-release-readiness.mjs"), [], {
    APP_REPO: "",
    GH_TOKEN: "",
    CLOUD_BASE_URL: "",
    OPENCODE_API_KEY: "",
    OPENROUTER_API_KEY: "provider-value-marker",
  });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.blockers.includes("target_repository_is_not_set_or_invalid"), true);
  assert.equal(result.stdout.includes("provider-value-marker"), false);
});

test("release readiness workflow is manual and injects credentials by reference", () => {
  const workflow = read(".github/workflows/release-readiness.yml");
  assert.equal(workflow.includes("workflow_dispatch:"), true);
  assert.equal(workflow.includes("npm run check:release"), true);
  assert.equal(workflow.includes("secrets.RELEASE_READINESS_TOKEN || github.token"), true);
  assert.equal(workflow.includes("secrets.OPENCODE_API_KEY"), true);
  assert.equal(workflow.includes("secrets.OPENROUTER_API_KEY"), true);
  assert.equal(workflow.includes('"${{ inputs.app_repo }}"'), false);
  assert.equal(/sk-[A-Za-z0-9]{10,}/.test(workflow), false);
});

test("APK evidence workflow verifies the exact artifact and rejects placeholder backend", () => {
  const workflow = read(".github/workflows/apk-evidence.yml");
  assert.equal(workflow.includes("workflow_dispatch:"), true);
  assert.equal(workflow.includes("cloud-opencode-debug"), true);
  assert.equal(workflow.includes("aapt dump badging"), true);
  assert.equal(workflow.includes("apksigner verify --verbose --print-certs"), true);
  assert.equal(workflow.includes("sha256sum"), true);
  assert.equal(workflow.includes("cloud-opencode-backend.example"), true);
  assert.equal(workflow.includes("build_config_test=PASSED"), true);
  assert.equal(workflow.includes('"${{ inputs.run_id }}"'), false);
});

test("deploy file checker passes the hardened single-host runtime shape", () => {
  const result = run(script("../scripts/check-deploy-files.mjs"));
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, true);
  assert.equal(report.checks.backendBoundToLoopback, true);
  assert.equal(report.checks.persistentDatabaseVolume, true);
  assert.equal(report.checks.caddySetsHsts, true);
  assert.equal(report.checks.envExampleDocumentsHealthUrl, true);
});
