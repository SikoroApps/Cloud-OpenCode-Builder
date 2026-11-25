import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import {
  clientIpFromRequest,
  createFixedWindowRateLimiter,
  RATE_LIMIT_POLICIES,
  selectRateLimitPolicy,
  type RateLimitDecision,
  type RateLimitPolicy,
  type RateLimiter,
} from "../src/rate-limit.ts";
import { baseDependencies, registerUser, startServer } from "./phase6-8-helpers.ts";

const TEST_POLICY: RateLimitPolicy = { name: "test", scope: "ip", limit: 2, windowMs: 1000 };

function fakeRequest(remoteAddress: string, forwarded?: string): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: forwarded ? { "x-forwarded-for": forwarded } : {},
  } as unknown as IncomingMessage;
}

test("fixed window allows the configured count, rejects excess and resets", () => {
  let current = 10_000;
  const limiter = createFixedWindowRateLimiter({ now: () => current });
  assert.equal(limiter.check("client-a", TEST_POLICY).allowed, true);
  assert.equal(limiter.check("client-a", TEST_POLICY).allowed, true);
  const denied = limiter.check("client-a", TEST_POLICY);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterSeconds, 1);
  assert.equal(limiter.check("client-b", TEST_POLICY).allowed, true);
  current += 1000;
  assert.equal(limiter.check("client-a", TEST_POLICY).allowed, true);
});

test("limiter bounds its key store", () => {
  let current = 5000;
  const limiter = createFixedWindowRateLimiter({ now: () => current, maxKeys: 2 });
  for (const key of ["a", "b", "c", "d"]) limiter.check(key, TEST_POLICY);
  assert.equal(limiter.check("e", TEST_POLICY).allowed, true);
});

test("proxy headers are only trusted when explicitly enabled", () => {
  const req = fakeRequest("10.0.0.1", "203.0.113.9, 10.0.0.1");
  assert.equal(clientIpFromRequest(req, false), "10.0.0.1");
  assert.equal(clientIpFromRequest(req, true), "203.0.113.9");
  assert.equal(clientIpFromRequest(fakeRequest("10.0.0.1", "not valid!"), true), "10.0.0.1");
});

test("policies map endpoints to the intended scope", () => {
  assert.equal(selectRateLimitPolicy("/api/auth/login", "POST").name, "auth");
  assert.equal(selectRateLimitPolicy("/api/chat", "POST").name, "ai");
  assert.equal(selectRateLimitPolicy("/api/images/abc/analyze", "POST").name, "ai");
  assert.equal(selectRateLimitPolicy("/api/images/generate", "POST").name, "heavy");
  assert.equal(selectRateLimitPolicy("/api/tasks", "GET").name, "general");
  assert.equal(selectRateLimitPolicy("/api/github/oauth/start", "GET").scope, "user");
  assert.equal(RATE_LIMIT_POLICIES.auth.scope, "ip");
});

test("HTTP responses expose limit headers and a safe 429 with Retry-After", async () => {
  const keys: string[] = [];
  const denyingLimiter: RateLimiter = {
    check(key: string, policy: RateLimitPolicy): RateLimitDecision {
      keys.push(key);
      return {
        allowed: false,
        limit: policy.limit,
        remaining: 0,
        retryAfterSeconds: 7,
        windowSeconds: Math.ceil(policy.windowMs / 1000),
      };
    },
  };
  const limited = await startServer(baseDependencies({ rateLimiter: denyingLimiter, rateLimitEnabled: true }));
  const normal = await startServer(baseDependencies());
  try {
    const auth = await registerUser(normal.baseUrl);
    const register = await fetch(`${limited.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "rate-limit@example.invalid", password: "password-1234" }),
    });
    assert.equal(register.status, 429);
    assert.equal(register.headers.get("retry-after"), "7");
    assert.equal(register.headers.get("x-ratelimit-limit"), "20");
    assert.deepEqual(await register.json(), { error: "rate_limited", retryAfterSeconds: 7 });

    const chat = await fetch(`${limited.baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "rate-limit", content: "hello" }),
    });
    assert.equal(chat.status, 429);
    assert.equal(chat.headers.get("x-ratelimit-limit"), "30");

    assert.equal(keys[0]?.startsWith("auth:ip:"), true);
    assert.equal(keys[1]?.startsWith("ai:user:"), true);
  } finally {
    await limited.close();
    await normal.close();
  }
});
