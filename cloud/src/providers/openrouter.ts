import type { FallbackCandidate } from "../types.ts";
import { loadConfig } from "../config.ts";

export interface OpenRouterProviderOptions {
  apiKey?: string;
  appUrl?: string;
  appName?: string;
  fetchImpl?: typeof fetch;
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): {
  complete(input: { candidate: FallbackCandidate; messages: { role: string; content: string }[]; signal?: AbortSignal }): Promise<{ result: { content: string; finishReason: string } } | { error: { message: string; status?: number; kind?: string } }>;
} {
  const config = loadConfig();
  const apiKey = options.apiKey !== undefined ? options.apiKey : config.openRouterApiKey;
  const appUrl = options.appUrl !== undefined ? options.appUrl : config.baseUrl;
  const appName = options.appName || "Cloud OpenCode Builder";
  const fetchImpl = options.fetchImpl || fetch;

  return {
    async complete({ candidate, messages, signal }) {
      if (!apiKey) {
        return { error: { message: "openrouter_api_key_not_configured", status: 401, kind: "unauthorized" } };
      }
      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // OpenRouter uses these for app attribution and free-model eligibility.
          "HTTP-Referer": appUrl,
          "X-Title": appName,
        },
        body: JSON.stringify({
          model: candidate.modelID,
          messages: messages.map((message) => ({
            role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
            content: message.content,
          })),
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
