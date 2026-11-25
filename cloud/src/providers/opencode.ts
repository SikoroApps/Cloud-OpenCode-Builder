import { Buffer } from "node:buffer";
import type { FallbackCandidate } from "../types.ts";
import { loadConfig } from "../config.ts";

export interface OpenCodeProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createOpenCodeProvider(options: OpenCodeProviderOptions = {}): {
  complete(input: { candidate: FallbackCandidate; messages: { role: string; content: string }[]; signal?: AbortSignal }): Promise<{ result: { content: string; finishReason: string } } | { error: { message: string; status?: number; kind?: string } }>;
} {
  const config = loadConfig();
  const apiKey = options.apiKey !== undefined ? options.apiKey : config.openCodeApiKey;
  const baseUrl = options.baseUrl !== undefined ? options.baseUrl : config.openCodeBaseUrl;
  const fetchImpl = options.fetchImpl || fetch;

  return {
    async complete({ candidate, messages, signal }) {
      if (!apiKey) {
        return { error: { message: "opencode_api_key_not_configured", status: 401, kind: "unauthorized" } };
      }
      const prompt = buildPrompt(messages);
      const response = await fetchImpl(`${baseUrl}/api/experimental/generate/text`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`opencode:${apiKey}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: { providerID: candidate.providerID, id: candidate.modelID },
          prompt,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as any;
      if (!response.ok) {
        const error: { message: string; status?: number; kind?: string } = {
          message: String(body?.message || body?._tag || "opencode_provider_error"),
          status: response.status,
          kind: String(body?.reason || body?._tag || "provider_error"),
        };
        return { error };
      }
      const content = String(body?.data?.content ?? body?.content ?? body?.data?.text ?? body?.text ?? "");
      const finishReason = String(body?.data?.finishReason ?? body?.finishReason ?? "stop");
      return { result: { content, finishReason } };
    },
  };
}

function buildPrompt(messages: { role: string; content: string }[]): string {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const turns: string[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const prefix = message.role === "user" ? "User:\n" : "Assistant:\n";
    turns.push(`${prefix}${message.content}`);
  }
  const transcript = [...(system ? [`System:\n${system}`] : []), ...turns].join("\n\n");
  return transcript || "Reply with exactly OK";
}
