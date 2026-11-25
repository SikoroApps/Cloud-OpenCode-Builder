import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_CIRCUIT_BREAKER_COOLDOWN_MS,
  FALLBACK_CHAIN,
  createAiCircuitBreaker,
  getAiCircuitBreakerSnapshot,
  isEligibleError,
  runAiFallback,
} from "../src/ai.ts";

const GEMMA = "openrouter/google/gemma-4-26b-a4b-it:free";
const BIG_PICKLE = "opencode/big-pickle";
const DEEPSEEK = "opencode/deepseek-v4.1-flash-free";

const rateLimit = { message: "Provider returned error", status: 429, kind: "rate_limit" };

test("fallback chain keeps the required free model order", () => {
  assert.deepEqual(FALLBACK_CHAIN.map((candidate) => candidate.id), [
    BIG_PICKLE,
    DEEPSEEK,
    "opencode/flint-40b-free",
    "openrouter/baidu/ernie-5.5-flash-preview:free",
    GEMMA,
  ]);
});

test("eligible errors include rate limit and temporary server errors", () => {
  assert.equal(isEligibleError({ status: 429 }), true);
  assert.equal(isEligibleError({ status: 402 }), true);
  assert.equal(isEligibleError({ status: 500 }), true);
  assert.equal(isEligibleError({ status: 404 }), false);
  assert.equal(isEligibleError({ message: "Provider returned error", kind: "429" }), true);
});

test("fallback switches to the next model after an eligible error", async () => {
  const calls: string[] = [];
  const circuitBreaker = createAiCircuitBreaker();
  const result = await runAiFallback({
    messages: [{ role: "user", content: "Reply with exactly FALLBACK_OK" }],
    circuitBreaker,
    now: () => 0,
    providerFor: (candidate) => ({
      complete: async () => {
        calls.push(candidate.id);
        if (candidate.id === BIG_PICKLE) return { error: rateLimit };
        return { result: { content: "FALLBACK_OK", finishReason: "stop" } };
      },
    }),
  });
  assert.equal(result.model, DEEPSEEK);
  assert.equal(result.content, "FALLBACK_OK");
  assert.deepEqual(calls, [BIG_PICKLE, DEEPSEEK]);
  assert.equal(getAiCircuitBreakerSnapshot(circuitBreaker, 0)[BIG_PICKLE].failures, 1);
});

test("fallback stops after a non-eligible error", async () => {
  let calls = 0;
  const circuitBreaker = createAiCircuitBreaker();
  await assert.rejects(
    runAiFallback({
      messages: [{ role: "user", content: "Hello" }],
      maxAttempts: 5,
      circuitBreaker,
      now: () => 0,
      providerFor: () => ({
        complete: async () => {
          calls += 1;
          return { error: { message: "not found", status: 404, kind: "not_found" } };
        },
      }),
    }),
    (error: any) => error.name === "AiModelFallbackError",
  );
  assert.equal(calls, 1);
});

test("each model is attempted at most twice and failed models are never reported as success", async () => {
  const calls: string[] = [];
  const circuitBreaker = createAiCircuitBreaker();
  let thrown: any;
  try {
    await runAiFallback({
      messages: [{ role: "user", content: "Hello" }],
      circuitBreaker,
      now: () => 0,
      providerFor: (candidate) => ({
        complete: async () => {
          calls.push(candidate.id);
          return { error: rateLimit };
        },
      }),
    });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.name, "AiModelFallbackError");
  assert.equal(calls.length, FALLBACK_CHAIN.length * 2);
  for (const candidate of FALLBACK_CHAIN) {
    assert.equal(calls.filter((id) => id === candidate.id).length, 2);
  }
  assert.equal(thrown.attempts.length, FALLBACK_CHAIN.length * 2);
  assert.ok(thrown.attempts.every((attempt: any) => attempt.finishReason === "error"));
  assert.ok(thrown.attempts.every((attempt: any) => attempt.status === 429));
  const snapshot = getAiCircuitBreakerSnapshot(circuitBreaker, 0);
  for (const candidate of FALLBACK_CHAIN) {
    assert.equal(snapshot[candidate.id].open, true);
  }
});

test("circuit breaker excludes a repeatedly failing model and uses the next healthy model", async () => {
  const calls: string[] = [];
  const circuitBreaker = createAiCircuitBreaker();
  const result = await runAiFallback({
    messages: [{ role: "user", content: "Hello" }],
    circuitBreaker,
    now: () => 0,
    providerFor: (candidate) => ({
      complete: async () => {
        calls.push(candidate.id);
        if (candidate.id === BIG_PICKLE) return { error: rateLimit };
        if (candidate.id === DEEPSEEK && calls.filter((id) => id === DEEPSEEK).length > 1) {
          return { result: { content: "HEALTHY", finishReason: "stop" } };
        }
        return { error: rateLimit };
      },
    }),
  });
  assert.equal(result.model, DEEPSEEK);
  assert.equal(result.content, "HEALTHY");
  assert.deepEqual(calls, [
    BIG_PICKLE,
    DEEPSEEK,
    "opencode/flint-40b-free",
    "openrouter/baidu/ernie-5.5-flash-preview:free",
    GEMMA,
    BIG_PICKLE,
    DEEPSEEK,
  ]);
  const snapshot = getAiCircuitBreakerSnapshot(circuitBreaker, 0);
  assert.equal(snapshot[BIG_PICKLE].open, true);
  assert.equal(snapshot[DEEPSEEK]?.open ?? false, false);
});

test("Gemma failure wraps to a healthy free model without retrying Gemma in the same pass", async () => {
  const calls: string[] = [];
  const circuitBreaker = createAiCircuitBreaker();
  const result = await runAiFallback({
    messages: [{ role: "user", content: "Hello" }],
    circuitBreaker,
    now: () => 0,
    providerFor: (candidate) => ({
      complete: async () => {
        calls.push(candidate.id);
        if (calls.filter((id) => id === candidate.id).length === 1) {
          return { error: rateLimit };
        }
        return { result: { content: "RECOVERED", finishReason: "stop" } };
      },
    }),
  });
  assert.equal(result.model, BIG_PICKLE);
  assert.equal(result.content, "RECOVERED");
  assert.deepEqual(calls, [
    BIG_PICKLE,
    DEEPSEEK,
    "opencode/flint-40b-free",
    "openrouter/baidu/ernie-5.5-flash-preview:free",
    GEMMA,
    BIG_PICKLE,
  ]);
  assert.equal(getAiCircuitBreakerSnapshot(circuitBreaker, 0)[GEMMA].open, false);
});

test("repeated Gemma failure opens its circuit and recovers after cooldown", async () => {
  const circuitBreaker = createAiCircuitBreaker();
  const atStart = 1_000;
  const failingCalls: string[] = [];
  let thrown: any;
  try {
    await runAiFallback({
      messages: [{ role: "user", content: "Hello" }],
      circuitBreaker,
      now: () => atStart,
      providerFor: (candidate) => ({
        complete: async () => {
          failingCalls.push(candidate.id);
          return { error: rateLimit };
        },
      }),
    });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.name, "AiModelFallbackError");
  assert.equal(getAiCircuitBreakerSnapshot(circuitBreaker, atStart)[GEMMA].open, true);

  const recoveryCalls: string[] = [];
  const recoveredAt = atStart + AI_CIRCUIT_BREAKER_COOLDOWN_MS + 1;
  const recovered = await runAiFallback({
    messages: [{ role: "user", content: "Hello" }],
    circuitBreaker,
    now: () => recoveredAt,
    providerFor: (candidate) => ({
      complete: async () => {
        recoveryCalls.push(candidate.id);
        if (candidate.id === GEMMA) {
          return { result: { content: "GEMMA_RECOVERED", finishReason: "stop" } };
        }
        return { error: rateLimit };
      },
    }),
  });
  assert.equal(recovered.model, GEMMA);
  assert.equal(recovered.content, "GEMMA_RECOVERED");
  assert.equal(recoveryCalls.filter((id) => id === GEMMA).length, 1);
  assert.equal(getAiCircuitBreakerSnapshot(circuitBreaker, recoveredAt)[GEMMA]?.open ?? false, false);
});
