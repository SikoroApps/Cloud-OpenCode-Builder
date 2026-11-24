import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, createUserSession, resolveUserByToken } from "./auth.ts";
import { getChatHistory, appendChatMessage, runAssistantTurn } from "./chat.ts";
import { FALLBACK_CHAIN } from "./ai.ts";
import { getDb } from "./db.ts";
import { loadConfig } from "./config.ts";

export interface AuthUser { id: string; email: string }

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }
  if (req.method === "GET" && path === "/api/models") {
    sendJson(res, 200, { models: FALLBACK_CHAIN.map((candidate) => candidate.id) });
    return;
  }
  if (req.method === "POST" && path === "/api/auth/register") {
    const body = await readJson(req);
    const email = String(body?.email || "");
    const password = String(body?.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      sendJson(res, 400, { error: "invalid_request" });
      return;
    }
    const existing = getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (existing) {
      sendJson(res, 409, { error: "email_taken" });
      return;
    }
    const salt = randomUUID().replace(/-/g, "");
    const userId = randomUUID();
    const passwordHash = hashPassword(password, salt);
    const now = Date.now();
    getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
      "INSERT INTO users (id, email, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(userId, email, passwordHash, salt, now, now);
    const session = createUserSession(userId, now);
    sendJson(res, 201, { user: { id: userId, email }, token: session.token });
    return;
  }
  if (req.method === "POST" && path === "/api/auth/login") {
    const body = await readJson(req);
    const email = String(body?.email || "");
    const password = String(body?.password || "");
    const user = getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (!user || !verifyPassword(password, String(user.password_hash))) {
      sendJson(res, 401, { error: "invalid_credentials" });
      return;
    }
    const session = createUserSession(String(user.id), Date.now());
    sendJson(res, 200, { user: { id: String(user.id), email: String(user.email) }, token: session.token });
    return;
  }
  const auth = await authenticate(req);
  if (!auth.userId) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (req.method === "GET" && path === "/api/auth/me") {
    const user = getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare("SELECT id, email FROM users WHERE id = ?").get(auth.userId) as any;
    sendJson(res, 200, { user: { id: String(user.id), email: String(user.email) } });
    return;
  }
  if (req.method === "POST" && path === "/api/auth/logout") {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const tokenHash = createHashHex(token);
    getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare("UPDATE sessions SET revoked = 1 WHERE token_hash = ?").run(tokenHash);
    sendJson(res, 204, {});
    return;
  }
  if (req.method === "GET" && path === "/api/chat/history") {
    const sessionKey = url.searchParams.get("sessionKey") || "default";
    const history = getChatHistory(auth.userId, sessionKey, 200);
    sendJson(res, 200, { history });
    return;
  }
  if (req.method === "POST" && path === "/api/chat") {
    const body = await readJson(req);
    const sessionKey = String(body?.sessionKey || "default");
    const content = String(body?.content || "");
    if (!content.trim()) {
      sendJson(res, 400, { error: "invalid_request" });
      return;
    }
    const { userMessage, assistantMessage, ai } = await runAssistantTurn({ userId: auth.userId, sessionKey, content });
    sendJson(res, 200, { userMessage, assistantMessage, ai });
    return;
  }
  sendJson(res, 404, { error: "not_found" });
}

async function authenticate(req: IncomingMessage): Promise<{ userId: string } | { userId: null }> {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const tokenHash = createHashHex(token);
  const userId = resolveUserByToken(token, Date.now());
  return { userId };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

import { createHash } from "node:crypto";
function createHashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createApiHandler(deps: { config: ReturnType<typeof loadConfig> }) {
  return async (req: IncomingMessage, res: ServerResponse) => handleApiRequest(req, res);
}
