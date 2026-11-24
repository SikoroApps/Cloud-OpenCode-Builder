import type { FallbackCandidate } from "../types.ts";
import { loadConfig } from "../config.ts";

export function createOpenCodeProvider(): {
  complete(input: { candidate: FallbackCandidate; messages: { role: string; content: string }[]; signal?: AbortSignal }): Promise<{ result: { content: string; finishReason: string } } | { error: { message: string; status?: number; kind?: string } }>;
} {
  const config = loadConfig();
  return {
    async complete({ candidate, messages, signal }) {
      const prompt = buildPrompt(messages);
      const response = await fetch(`${config.openCodeBaseUrl}/api/experimental/generate/text`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`opencode:${config.openCodeApiKey}`).toString("base64")}`,
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
