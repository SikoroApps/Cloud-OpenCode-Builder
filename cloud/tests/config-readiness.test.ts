import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import type { GithubConfig } from "../src/config.ts";
import { getConfigReadiness, REQUIRED_ACTIONS_SECRET_NAMES } from "../src/readiness.ts";

function github(overrides: Partial<GithubConfig> = {}): GithubConfig {
  return {
    clientId: "client-id-marker",
    clientSecret: "client-secret-marker",
    redirectUri: "https://backend.example.invalid/api/github/oauth/callback",
    appCallbackUrl: "cloudopencode://github/callback",
    apiBaseUrl: "https://api.github.com",
    authBaseUrl: "https://github.com",
    tokenEncryptionKey: Buffer.alloc(32, 7),
    ...overrides,
  };
}

test("readiness output contains only presence checks and blocker codes", () => {
  const readiness = getConfigReadiness(github(), {
    baseUrl: "https://backend.example.invalid",
    openRouterApiKeySet: true,
    openCodeApiKeySet: false,
  });
  const serialized = JSON.stringify(readiness);
  assert.equal(serialized.includes("client-id-marker"), false);
  assert.equal(serialized.includes("client-secret-marker"), false);
  assert.equal(serialized.includes("https://backend.example.invalid/api/github/oauth/callback"), false);
  assert.equal(readiness.githubOAuth.configured, true);
  assert.equal(readiness.readyForLiveOAuth, true);
  assert.equal(readiness.readyForLiveAiEditing, true);
  assert.equal(readiness.blockers.length, 0);
  assert.deepEqual([...readiness.requiredActionsSecrets], [...REQUIRED_ACTIONS_SECRET_NAMES]);
});

test("readiness rejects an OAuth callback host that differs from the backend host", () => {
  const readiness = getConfigReadiness(github({
    redirectUri: "https://oauth.other.example.invalid/api/github/oauth/callback",
  }), {
    baseUrl: "https://backend.example.invalid",
    openRouterApiKeySet: true,
    openCodeApiKeySet: false,
  });
  assert.equal(readiness.githubOAuth.redirectUriMatchesBaseUrl, false);
  assert.equal(readiness.readyForLiveOAuth, false);
  assert.equal(readiness.readyForLiveBuilds, false);
  assert.equal(readiness.blockers.includes("GITHUB_OAUTH_REDIRECT_URI host must match CLOUD_BASE_URL host"), true);
  assert.equal(JSON.stringify(readiness).includes("oauth.other.example.invalid"), false);
});

test("readiness rejects a non-mobile OAuth app callback scheme", () => {
  const readiness = getConfigReadiness(github({
    appCallbackUrl: "https://evil.example.invalid/callback",
  }), {
    baseUrl: "https://backend.example.invalid",
    openRouterApiKeySet: true,
    openCodeApiKeySet: false,
  });
  assert.equal(readiness.githubOAuth.appCallbackSchemeValid, false);
  assert.equal(readiness.readyForLiveOAuth, false);
  assert.equal(readiness.blockers.includes("GITHUB_APP_CALLBACK_URL must use the cloudopencode scheme"), true);
  assert.equal(JSON.stringify(readiness).includes("evil.example.invalid"), false);
});

test("readiness reports missing configuration without secret values", () => {
  const readiness = getConfigReadiness(github({
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    tokenEncryptionKey: null,
  }), {
    baseUrl: "http://localhost:8080",
    openRouterApiKeySet: false,
    openCodeApiKeySet: false,
  });
  assert.equal(readiness.readyForLiveOAuth, false);
  assert.equal(readiness.readyForLiveAiEditing, false);
  assert.equal(readiness.readyForLiveBuilds, false);
  assert.deepEqual(readiness.blockers, [
    "GITHUB_CLIENT_ID is not set",
    "GITHUB_CLIENT_SECRET is not set",
    "GITHUB_OAUTH_REDIRECT_URI must be an HTTPS URL",
    "GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes",
    "CLOUD_BASE_URL must be an HTTPS URL",
    "no AI provider key is configured for live AI file planning",
  ]);
  assert.equal(JSON.stringify(readiness).includes("marker"), false);
});
