import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let db: DatabaseSync | null = null;

export function getDb(path: string): DatabaseSync {
  if (db) return db;
  const dir = dirname(path);
  if (dir) mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export function insertUser(id: string, email: string, passwordHash: string, passwordSalt: string, now: number): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    "INSERT INTO users (id, email, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, email, passwordHash, passwordSalt, now, now);
}

export function findUserByEmail(email: string): any | undefined {
  const row = getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
  return row;
}

export function findUserById(id: string): any | undefined {
  const row = getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as any;
  return row;
}

export function insertSession(tokenHash: string, userId: string, now: number, expiresAt: number, revoked = 0): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, revoked) VALUES (?, ?, ?, ?, ?)",
  ).run(tokenHash, userId, now, expiresAt, revoked);
}

export function findSessionByHash(tokenHash: string): any | undefined {
  const row = getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as any;
  if (!row) return undefined;
  if (Number(row.revoked) === 1) return undefined;
  if (Number(row.expires_at) < Date.now()) {
    revokeSession(tokenHash);
    return undefined;
  }
  return row;
}

export function revokeSession(tokenHash: string): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare("UPDATE sessions SET revoked = 1 WHERE token_hash = ?").run(tokenHash);
}

export function insertChatMessage(input: {
  userId: string;
  sessionKey: string;
  role: string;
  content: string;
  model: string | null;
  now: number;
}): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    "INSERT INTO chat_messages (user_id, session_key, role, content, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(input.userId, input.sessionKey, input.role, input.content, input.model, input.now, input.now);
}

export function listChatMessages(userId: string, sessionKey: string, limit = 200): any[] {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      "SELECT id, user_id AS userId, session_key AS sessionKey, role, content, model, created_at AS createdAt, updated_at AS updatedAt FROM chat_messages WHERE user_id = ? AND session_key = ? ORDER BY id ASC LIMIT ?",
    )
    .all(userId, sessionKey, limit) as any[];
}

export function deleteChatMessages(userId: string, sessionKey: string): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare("DELETE FROM chat_messages WHERE user_id = ? AND session_key = ?").run(userId, sessionKey);
}
