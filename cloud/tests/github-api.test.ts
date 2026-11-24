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
import type { GithubService } from "../src/github.ts";
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

function mockService(): GithubService {
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
  };
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
  const server = await startServer({ githubConfig: githubConfig(), githubService: mockService() });
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
  const server = await startServer({ githubConfig: githubConfig(false), githubService: mockService() });
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
