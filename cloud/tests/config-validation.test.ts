import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { validateCloudConfig } from "../src/config-validation.ts";
import type { CloudConfig } from "../src/config.ts";

function config(overrides: Partial<CloudConfig> = {}): CloudConfig {
  const base: CloudConfig = {
    port: 8080,
    host: "0.0.0.0",
    baseUrl: "https://builder.example.invalid",
    openCodeBaseUrl: "http://127.0.0.1:49374",
    openCodeApiKey: "",
    openRouterApiKey: "provider-key-marker",
    github: {
      clientId: "client-id-marker",
      clientSecret: "client-secret-marker",
      redirectUri: "https://builder.example.invalid/api/github/oauth/callback",
      appCallbackUrl: "cloudopencode://github/callback",
      apiBaseUrl: "https://api.github.com",
      authBaseUrl: "https://github.com",
      tokenEncryptionKey: Buffer.alloc(32, 7),
    },
    rateLimitEnabled: true,
    trustProxy: true,
  };
  return {
    ...base,
    ...overrides,
    github: { ...base.github, ...(overrides.github || {}) },
  };
}

test("valid production configuration has no validation error", () => {
  assert.equal(validateCloudConfig(config(), true), null);
});

test("local development may omit OAuth credentials", () => {
  const local = config({
    baseUrl: "http://localhost:8080",
    github: {
      clientId: "",
      clientSecret: "",
      redirectUri: "",
      appCallbackUrl: "cloudopencode://github/callback",
      apiBaseUrl: "https://api.github.com",
      authBaseUrl: "https://github.com",
      tokenEncryptionKey: null,
    },
    trustProxy: false,
  });
  assert.equal(validateCloudConfig(local, false), null);
});

test("production rejects unsafe transport and proxy settings with codes only", () => {
  assert.equal(
    validateCloudConfig(config({ baseUrl: "http://builder.example.invalid" }), true),
    "CLOUD_BASE_URL must use https in production",
  );
  assert.equal(
    validateCloudConfig(config({ rateLimitEnabled: false }), true),
    "RATE_LIMIT_ENABLED must be 1 in production",
  );
  assert.equal(
    validateCloudConfig(config({ trustProxy: false }), true),
    "TRUST_PROXY must be 1 behind the HTTPS reverse proxy",
  );
});

test("production rejects missing OAuth values without printing them", () => {
  const error = validateCloudConfig(config({
    github: {
      clientId: "",
      clientSecret: "client-secret-marker",
      redirectUri: "https://builder.example.invalid/api/github/oauth/callback",
      appCallbackUrl: "cloudopencode://github/callback",
      apiBaseUrl: "https://api.github.com",
      authBaseUrl: "https://github.com",
      tokenEncryptionKey: Buffer.alloc(32, 7),
    },
  }), true);
  assert.equal(error, "GITHUB_CLIENT_ID is not set");
  assert.equal(String(error).includes("client-secret-marker"), false);
});

test("OAuth callback host, path and mobile scheme are validated", () => {
  assert.equal(
    validateCloudConfig(config({
      github: {
        clientId: "client-id-marker",
        clientSecret: "client-secret-marker",
        redirectUri: "https://other.example.invalid/api/github/oauth/callback",
        appCallbackUrl: "cloudopencode://github/callback",
        apiBaseUrl: "https://api.github.com",
        authBaseUrl: "https://github.com",
        tokenEncryptionKey: Buffer.alloc(32, 7),
      },
    }), true),
    "GITHUB_OAUTH_REDIRECT_URI host must match CLOUD_BASE_URL host",
  );
  assert.equal(
    validateCloudConfig(config({
      github: {
        clientId: "client-id-marker",
        clientSecret: "client-secret-marker",
        redirectUri: "https://builder.example.invalid/incorrect",
        appCallbackUrl: "cloudopencode://github/callback",
        apiBaseUrl: "https://api.github.com",
        authBaseUrl: "https://github.com",
        tokenEncryptionKey: Buffer.alloc(32, 7),
      },
    }), true),
    "GITHUB_OAUTH_REDIRECT_URI path must be /api/github/oauth/callback",
  );
  assert.equal(
    validateCloudConfig(config({
      github: {
        clientId: "client-id-marker",
        clientSecret: "client-secret-marker",
        redirectUri: "https://builder.example.invalid/api/github/oauth/callback",
        appCallbackUrl: "https://phone.example.invalid/callback",
        apiBaseUrl: "https://api.github.com",
        authBaseUrl: "https://github.com",
        tokenEncryptionKey: Buffer.alloc(32, 7),
      },
    }), true),
    "GITHUB_APP_CALLBACK_URL must use the cloudopencode scheme",
  );
});
