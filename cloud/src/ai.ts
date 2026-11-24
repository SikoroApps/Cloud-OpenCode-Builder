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

export function isEligibleError(error: AiError): boolean {
  if (typeof error?.status === "number") return ELIGIBLE_STATUS_CODES.has(error.status);
  const kind = String(error?.kind || error?.name || "").toLowerCase();
  return ["rate_limit", "quota", "unauthorized", "auth", "unavailable", "timeout", "overloaded", "service_unavailable", "temporary", "ai_fallback_exhausted"].includes(kind);
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

export async function runAiFallback(input: {
  messages: { role: string; content: string }[];
  signal?: AbortSignal;
  maxAttempts?: number;
  providerFor?: (candidate: FallbackCandidate) => ReturnType<typeof createAiProvider>;
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
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? FALLBACK_CHAIN.length, FALLBACK_CHAIN.length));
  const attempts: AiAttemptResult[] = [];
  const providerFor = input.providerFor ?? ((candidate: FallbackCandidate) => createAiProvider(candidate));

  for (let index = 0; index < maxAttempts; index += 1) {
    const candidate = FALLBACK_CHAIN[index];
    const outcome = await providerFor(candidate).complete({ candidate, messages: input.messages, signal: input.signal });
    if (outcome.result) {
      const attempt: AiAttemptResult = { model: candidate.id, content: outcome.result.content, finishReason: outcome.result.finishReason };
      attempts.push(attempt);
      return { model: candidate.id, content: outcome.result.content, finishReason: outcome.result.finishReason, attempts };
    }
    attempts.push({ model: candidate.id, content: "", finishReason: "error" });
    const error = outcome.error as AiError;
    const next = FALLBACK_CHAIN[index + 1];
    if (!next || !isEligibleError(error)) break;
  }

  const fallbackError: AiError = { message: "ai_fallback_exhausted", status: 503, kind: "ai_fallback_exhausted", attempts };
  throw Object.assign(new Error("AI model fallback exhausted"), { name: "AiModelFallbackError", ...fallbackError });
}
