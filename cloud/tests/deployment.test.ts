import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import type { GithubConfig } from "../src/config.ts";
import { getConfigReadiness } from "../src/readiness.ts";
import { evaluateDeploymentReadiness } from "../src/deployment.ts";

function github(overrides: Partial<GithubConfig> = {}): GithubConfig {
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

function readinessFor(ready: boolean) {
  const readiness = getConfigReadiness(github({
    clientId: ready ? "client-id" : "",
    clientSecret: ready ? "client-secret" : "",
    redirectUri: ready ? "https://backend.example.invalid/api/github/oauth/callback" : "",
    tokenEncryptionKey: ready ? Buffer.alloc(32, 9) : null,
  }), {
    baseUrl: ready ? "https://backend.example.invalid" : "http://localhost:8080",
    openRouterApiKeySet: ready,
    openCodeApiKeySet: false,
  });
  return readiness;
}

test("deployment readiness reports booleans and blocker codes only", () => {
  const ready = evaluateDeploymentReadiness(readinessFor(true), {
    databaseDirectoryWritable: true,
    healthUrlConfigured: true,
    healthUrlIsHttps: true,
    healthStatus: 200,
    rateLimitEnabled: true,
    trustProxy: true,
  });
  assert.equal(ready.readyForDeployment, true);
  assert.deepEqual(ready.blockers, []);
  assert.equal(ready.checks.databaseDirectoryWritable, true);
  assert.equal(ready.checks.httpsBaseUrl, true);
  assert.equal(ready.checks.githubOAuthReady, true);
  assert.equal(ready.checks.liveAiReady, true);
  assert.equal(ready.checks.healthCheckHttps, true);
  assert.equal(ready.checks.healthCheckOk, true);
  assert.equal(ready.checks.oauthRedirectMatchesBaseUrl, true);
  assert.equal(ready.checks.oauthRedirectPathValid, true);
  assert.equal(ready.checks.rateLimitingEnabled, true);
  assert.equal(ready.checks.proxyTrustConfigured, true);
});

test("deployment readiness reports masked blockers when prerequisites are missing", () => {
  const ready = evaluateDeploymentReadiness(readinessFor(false), {
    databaseDirectoryWritable: false,
    healthUrlConfigured: true,
    healthUrlIsHttps: false,
    healthStatus: null,
    rateLimitEnabled: false,
    trustProxy: false,
  });
  assert.equal(ready.readyForDeployment, false);
  assert.equal(ready.checks.databaseDirectoryWritable, false);
  assert.equal(ready.checks.httpsBaseUrl, false);
  assert.equal(ready.checks.healthCheckHttps, false);
  assert.equal(ready.checks.healthCheckOk, false);
  assert.equal(ready.checks.oauthRedirectMatchesBaseUrl, false);
  assert.equal(ready.checks.oauthRedirectPathValid, false);
  assert.equal(ready.checks.rateLimitingEnabled, false);
  assert.equal(ready.checks.proxyTrustConfigured, false);
  assert.deepEqual(ready.blockers, [
    "database directory is not writable",
    "CLOUD_BASE_URL must be an HTTPS URL",
    "GitHub OAuth configuration is not ready",
    "GITHUB_OAUTH_REDIRECT_URI host must match CLOUD_BASE_URL host",
    "no AI provider key is configured for live AI file planning",
    "DEPLOYMENT_HEALTH_URL must use https",
    "deployment health check did not return 200",
    "rate limiting must be enabled in production",
    "TRUST_PROXY must be 1 behind the HTTPS reverse proxy",
  ]);
  assert.equal(JSON.stringify(ready).includes("client-id"), false);
  assert.equal(JSON.stringify(ready).includes("client-secret"), false);
  assert.equal(JSON.stringify(ready).includes("backend.example.invalid"), false);
});
