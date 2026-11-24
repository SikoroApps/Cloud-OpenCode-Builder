import type { ChatMessage } from "./types.ts";
import * as db from "./db.ts";
import { runAiFallback } from "./ai.ts";

export function getChatHistory(userId: string, sessionKey: string, limit = 200): ChatMessage[] {
  const rows = db.listChatMessages(userId, sessionKey, limit) as any[];
  return rows.map((row) => ({
    id: Number(row.id),
    userId: String(row.userId),
    sessionKey: String(row.sessionKey),
    role: String(row.role) as "user" | "assistant",
    content: String(row.content),
    model: row.model ? String(row.model) : null,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }));
}

export function appendChatMessage(input: { userId: string; sessionKey: string; role: "user" | "assistant"; content: string; model: string | null; now: number }): ChatMessage {
  db.insertChatMessage({ userId: input.userId, sessionKey: input.sessionKey, role: input.role, content: input.content, model: input.model, now: input.now });
  const history = db.listChatMessages(input.userId, input.sessionKey, 200) as any[];
  const last = history[history.length - 1];
  if (!last) throw new Error("failed to persist chat message");
  return {
    id: Number(last.id),
    userId: String(last.userId),
    sessionKey: String(last.sessionKey),
    role: String(last.role) as "user" | "assistant",
    content: String(last.content),
    model: last.model ? String(last.model) : null,
    createdAt: Number(last.createdAt),
    updatedAt: Number(last.updatedAt),
  };
}

export async function runAssistantTurn(input: { userId: string; sessionKey: string; content: string }): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage; ai: Awaited<ReturnType<typeof runAiFallback>> }> {
  const now = Date.now();
  const userMessage = appendChatMessage({ userId: input.userId, sessionKey: input.sessionKey, role: "user", content: input.content, model: null, now });
  const history = getChatHistory(input.userId, input.sessionKey, 200);
  const messages = history.map((message) => ({ role: message.role, content: message.content }));
  const ai = await runAiFallback({ messages });
  const assistantMessage = appendChatMessage({ userId: input.userId, sessionKey: input.sessionKey, role: "assistant", content: ai.content, model: ai.model, now });
  return { userMessage, assistantMessage, ai };
}
