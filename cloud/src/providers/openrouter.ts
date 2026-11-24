import type { FallbackCandidate } from "../types.ts";
import { loadConfig } from "../config.ts";

export function createOpenRouterProvider(): {
  complete(input: { candidate: FallbackCandidate; messages: { role: string; content: string }[]; signal?: AbortSignal }): Promise<{ result: { content: string; finishReason: string } } | { error: { message: string; status?: number; kind?: string } }>;
} {
  const config = loadConfig();
  const apiKey = config.openRouterApiKey;
  return {
    async complete({ candidate, messages, signal }) {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: candidate.modelID,
          messages: messages.map((message) => ({ role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user", content: message.content })),
          max_tokens: 1024,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as any;
      if (!response.ok) {
        const error: { message: string; status?: number; kind?: string } = {
          message: String(body?.error?.message || body?.message || "openrouter_provider_error"),
          status: response.status,
          kind: String(body?.error?.code || body?.error?.type || "provider_error"),
        };
        return { error };
      }
      const content = String(body?.choices?.[0]?.message?.content ?? "");
      const finishReason = String(body?.choices?.[0]?.finish_reason ?? "stop");
      return { result: { content, finishReason } };
    },
  };
}
