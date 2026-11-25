import type { AiAttemptResult, AiError, AiRunResult, FallbackCandidate } from "./types.ts";
import { createOpenCodeProvider } from "./providers/opencode.ts";
import { createOpenRouterProvider } from "./providers/openrouter.ts";

export const FALLBACK_CHAIN: FallbackCandidate[] = [
  { id: "opencode/big-pickle", kind: "opencode", providerID: "opencode", modelID: "big-pickle" },
  { id: "opencode/deepseek-v4.1-flash-free", kind: "opencode", providerID: "opencode", modelID: "deepseek-v4.1-flash-free" },
  { id: "opencode/flint-40b-free", kind: "opencode", providerID: "opencode", modelID: "flint-40b-free" },
  { id: "openrouter/baidu/ernie-5.5-flash-preview:free", kind: "openrouter", providerID: "openrouter", modelID: "baidu/ernie-5.5-flash-preview:free" },
  { id: "openrouter/google/gemma-4-26b-a4b-it:free", kind: "openrouter", providerID: "openrouter", modelID: "google/gemma-4-26b-a4b-it:free" },
];

const ELIGIBLE_STATUS_CODES = new Set([401, 402, 429, 500, 502, 503, 504]);

/** At most one retry per model, on a later pass through the chain. */
export const AI_MAX_RETRIES_PER_MODEL = 1;
/** Two failures (initial attempt + one retry) open the circuit for this model. */
export const AI_CIRCUIT_BREAKER_FAILURE_THRESHOLD = AI_MAX_RETRIES_PER_MODEL + 1;
export const AI_CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

export interface AiCircuitBreakerEntry {
  failures: number;
  openUntil: number;
}

export interface AiCircuitBreaker {
  entries: Map<string, AiCircuitBreakerEntry>;
}

const defaultCircuitBreaker: AiCircuitBreaker = { entries: new Map() };

export function createAiCircuitBreaker(): AiCircuitBreaker {
  return { entries: new Map() };
}

export function resetAiCircuitBreaker(breaker: AiCircuitBreaker = defaultCircuitBreaker): void {
  breaker.entries.clear();
}

export function getAiCircuitBreakerSnapshot(
  breaker: AiCircuitBreaker = defaultCircuitBreaker,
  now: number = Date.now(),
): Record<string, { failures: number; openUntil: number; open: boolean; remainingMs: number }> {
  const snapshot: Record<string, { failures: number; openUntil: number; open: boolean; remainingMs: number }> = {};
  for (const [model, entry] of breaker.entries) {
    const remainingMs = Math.max(0, entry.openUntil - now);
    snapshot[model] = {
      failures: entry.failures,
      openUntil: entry.openUntil,
      open: remainingMs > 0,
      remainingMs,
    };
  }
  return snapshot;
}

function isCircuitOpen(breaker: AiCircuitBreaker, model: string, now: number): boolean {
  const entry = breaker.entries.get(model);
  return Boolean(entry && entry.openUntil > now);
}

function recordFailure(breaker: AiCircuitBreaker, model: string, now: number): void {
  const previous = breaker.entries.get(model);
  const failures = (previous?.failures ?? 0) + 1;
  const openUntil = failures >= AI_CIRCUIT_BREAKER_FAILURE_THRESHOLD
    ? now + AI_CIRCUIT_BREAKER_COOLDOWN_MS
    : 0;
  breaker.entries.set(model, { failures, openUntil });
}

function recordSuccess(breaker: AiCircuitBreaker, model: string): void {
  breaker.entries.delete(model);
}

export function isEligibleError(error: AiError): boolean {
  if (typeof error?.status === "number") return ELIGIBLE_STATUS_CODES.has(error.status);
  const kind = String(error?.kind || error?.name || "").toLowerCase();
  return ["rate_limit", "quota", "unauthorized", "auth", "unavailable", "timeout", "overloaded", "service_unavailable", "temporary", "ai_fallback_exhausted", "429", "500", "502", "503", "504"].includes(kind);
}

export interface AiCompletionOutcome {
  result?: { content: string; finishReason: string };
  error?: AiError;
}

export function createAiProvider(candidate: FallbackCandidate): {
  complete(input: { candidate: FallbackCandidate; messages: { role: string; content: string }[]; signal?: AbortSignal }): Promise<AiCompletionOutcome>;
} {
  return candidate.kind === "openrouter"
    ? createOpenRouterProvider()
    : createOpenCodeProvider();
}

interface SelectCandidateInput {
  startIndex: number;
  attemptsByModel: Map<string, number>;
  circuitBreaker: AiCircuitBreaker;
  now: number;
}

function selectNextCandidate(input: SelectCandidateInput): { candidate: FallbackCandidate; index: number } | undefined {
  for (let offset = 0; offset < FALLBACK_CHAIN.length; offset += 1) {
    const index = (input.startIndex + offset) % FALLBACK_CHAIN.length;
    const candidate = FALLBACK_CHAIN[index];
    const attempts = input.attemptsByModel.get(candidate.id) ?? 0;
    if (attempts >= AI_CIRCUIT_BREAKER_FAILURE_THRESHOLD) continue;
    if (isCircuitOpen(input.circuitBreaker, candidate.id, input.now)) continue;
    return { candidate, index };
  }
  return undefined;
}

export async function runAiFallback(input: {
  messages: { role: string; content: string }[];
  signal?: AbortSignal;
  maxAttempts?: number;
  providerFor?: (candidate: FallbackCandidate) => ReturnType<typeof createAiProvider>;
  circuitBreaker?: AiCircuitBreaker;
  now?: () => number;
}): Promise<AiRunResult> {
  if (process.env.CLOUD_AI_STUB === "1") {
    const lastUser = [...input.messages].reverse().find((message) => message.role === "user");
    return {
      model: "stub/local-test",
      content: `STUB:${lastUser?.content ?? ""}`,
      finishReason: "stop",
      attempts: [],
    };
  }

  const circuitBreaker = input.circuitBreaker ?? defaultCircuitBreaker;
  const now = input.now ?? Date.now;
  const maximum = FALLBACK_CHAIN.length * AI_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? maximum, maximum));
  const attempts: AiAttemptResult[] = [];
  const attemptsByModel = new Map<string, number>();
  const providerFor = input.providerFor ?? ((candidate: FallbackCandidate) => createAiProvider(candidate));

  let startIndex = 0;
  while (attempts.length < maxAttempts) {
    const selected = selectNextCandidate({
      startIndex,
      attemptsByModel,
      circuitBreaker,
      now: now(),
    });
    if (!selected) break;

    const { candidate, index } = selected;
    const outcome = await providerFor(candidate).complete({
      candidate,
      messages: input.messages,
      signal: input.signal,
    });
    const attemptCount = (attemptsByModel.get(candidate.id) ?? 0) + 1;
    attemptsByModel.set(candidate.id, attemptCount);

    if (outcome.result) {
      recordSuccess(circuitBreaker, candidate.id);
      const attempt: AiAttemptResult = {
        model: candidate.id,
        content: outcome.result.content,
        finishReason: outcome.result.finishReason,
      };
      attempts.push(attempt);
      return {
        model: candidate.id,
        content: outcome.result.content,
        finishReason: outcome.result.finishReason,
        attempts,
      };
    }

    const error = outcome.error as AiError;
    attempts.push({
      model: candidate.id,
      content: "",
      finishReason: "error",
      status: error?.status,
      kind: error?.kind,
    });
    recordFailure(circuitBreaker, candidate.id, now());

    if (!isEligibleError(error)) break;

    // Always advance to the next healthy free model after a temporary failure.
    // A model is retried at most once, on a later pass through the chain, and
    // only while its circuit remains closed.
    startIndex = (index + 1) % FALLBACK_CHAIN.length;
  }

  const fallbackError: AiError = { message: "ai_fallback_exhausted", status: 503, kind: "ai_fallback_exhausted", attempts };
  throw Object.assign(new Error("AI model fallback exhausted"), { name: "AiModelFallbackError", ...fallbackError });
}
