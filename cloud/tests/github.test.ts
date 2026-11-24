import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import type { GithubConfig } from "../src/config.ts";
import {
  createGithubService,
  decryptToken,
  encryptToken,
  isGithubConfigured,
  GITHUB_OAUTH_SCOPES,
} from "../src/github.ts";

function config(overrides: Partial<GithubConfig> = {}): GithubConfig {
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

test("authorization URL is least-privilege and never contains the client secret", () => {
  const cfg = config();
  const service = createGithubService(cfg);
  const url = new URL(service.authorizationUrl("state-123"));
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), cfg.redirectUri);
  assert.equal(url.searchParams.get("scope"), GITHUB_OAUTH_SCOPES);
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.get("allow_signup"), "false");
  assert.equal(url.search.includes("client-secret"), false);
});

test("token encryption round trips and rejects the wrong key", () => {
  const key = randomBytes(32);
  const encrypted = encryptToken("secret-token-value", key);
  assert.equal(decryptToken(encrypted, key), "secret-token-value");
  assert.notEqual(encrypted.ciphertext, "secret-token-value");
  assert.throws(() => decryptToken(encrypted, randomBytes(32)));
});

test("GitHub configuration requires credentials, HTTPS redirect and a 32-byte key", () => {
  assert.equal(isGithubConfigured(config()), true);
  assert.equal(isGithubConfigured(config({ clientSecret: "" })), false);
  assert.equal(isGithubConfigured(config({ redirectUri: "http://insecure.invalid/cb" })), false);
  assert.equal(isGithubConfigured(config({ tokenEncryptionKey: Buffer.alloc(16) })), false);
  assert.equal(isGithubConfigured(config({ tokenEncryptionKey: null })), false);
});

test("OAuth code exchange succeeds and never echoes provider errors with token material", async () => {
  const service = createGithubService(config(), (async (input: any, init: any) => {
    assert.equal(String(input), "https://github.com/login/oauth/access_token");
    assert.equal(init.method, "POST");
    assert.equal(String(init.body).includes("client-secret"), true);
    return new Response(JSON.stringify({ access_token: "exchange-token", scope: "public_repo workflow" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch);
  const exchange = await service.exchangeCode("code-123");
  assert.equal(exchange.accessToken, "exchange-token");
  assert.equal(exchange.scope, "public_repo workflow");

  const failing = createGithubService(config(), (async () =>
    new Response(JSON.stringify({ error: "bad_verification_code", access_token: "do-not-leak" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch);
  await assert.rejects(failing.exchangeCode("bad"), (error: any) => {
    assert.equal(error.code, "oauth_exchange_rejected");
    assert.equal(String(error.message).includes("do-not-leak"), false);
    return true;
  });
});
