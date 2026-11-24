import { test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_CHAIN, runAiFallback, isEligibleError } from "../src/ai.ts";

test("fallback chain keeps the required free model order", () => {
  assert.deepEqual(FALLBACK_CHAIN.map((candidate) => candidate.id), [
    "opencode/big-pickle",
    "opencode/deepseek-v4.1-flash-free",
    "opencode/flint-40b-free",
    "openrouter/baidu/ernie-5.5-flash-preview:free",
    "openrouter/google/gemma-4-26b-a4b-it:free",
  ]);
});

test("eligible errors include rate limit and temporary server errors", () => {
  assert.equal(isEligibleError({ status: 429 }), true);
  assert.equal(isEligibleError({ status: 402 }), true);
  assert.equal(isEligibleError({ status: 500 }), true);
  assert.equal(isEligibleError({ status: 404 }), false);
});

test("fallback switches to the next model after an eligible error", async () => {
  const calls: string[] = [];
  const result = await runAiFallback({
    messages: [{ role: "user", content: "Reply with exactly FALLBACK_OK" }],
    providerFor: (candidate) => ({
      complete: async () => {
        calls.push(candidate.id);
        if (candidate.id === "opencode/big-pickle") {
          return { error: { message: "free usage limit reached", status: 429, kind: "rate_limit" } };
        }
        return { result: { content: "FALLBACK_OK", finishReason: "stop" } };
      },
    }),
  });
  assert.equal(result.model, "opencode/deepseek-v4.1-flash-free");
  assert.equal(result.content, "FALLBACK_OK");
  assert.equal(calls.length, 2);
});

test("fallback stops after a non-eligible error", async () => {
  let calls = 0;
  await assert.rejects(
    runAiFallback({
      messages: [{ role: "user", content: "Hello" }],
      maxAttempts: 5,
      providerFor: (candidate) => ({
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

test("fallback exhausts after the configured chain length", async () => {
  let calls = 0;
  await assert.rejects(
    runAiFallback({
      messages: [{ role: "user", content: "Hello" }],
      providerFor: (candidate) => ({
        complete: async () => {
          calls += 1;
          return { error: { message: "rate limit", status: 429, kind: "rate_limit" } };
        },
      }),
    }),
    (error: any) => error.name === "AiModelFallbackError",
  );
  assert.equal(calls, FALLBACK_CHAIN.length);
});
