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
    CREATE TABLE IF NOT EXISTS github_oauth_states (
      state_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS github_connections (
      user_id TEXT PRIMARY KEY,
      github_user_id INTEGER NOT NULL,
      login TEXT NOT NULL,
      scopes TEXT NOT NULL,
      token_ciphertext TEXT NOT NULL,
      token_iv TEXT NOT NULL,
      token_tag TEXT NOT NULL,
      connected_at INTEGER NOT NULL,
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

export function insertGithubState(stateHash: string, userId: string, now: number, expiresAt: number): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    "INSERT INTO github_oauth_states (state_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(stateHash, userId, now, expiresAt);
}

export function findGithubState(stateHash: string): any | undefined {
  const row = getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare("SELECT state_hash, user_id, expires_at FROM github_oauth_states WHERE state_hash = ?")
    .get(stateHash) as any;
  if (!row) return undefined;
  if (Number(row.expires_at) < Date.now()) {
    deleteGithubState(stateHash);
    return undefined;
  }
  return row;
}

export function deleteGithubState(stateHash: string): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare("DELETE FROM github_oauth_states WHERE state_hash = ?")
    .run(stateHash);
}

export function saveGithubConnection(input: {
  userId: string;
  githubUserId: number;
  login: string;
  scopes: string;
  ciphertext: string;
  iv: string;
  tag: string;
  now: number;
}): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `INSERT INTO github_connections
      (user_id, github_user_id, login, scopes, token_ciphertext, token_iv, token_tag, connected_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
      github_user_id = excluded.github_user_id,
      login = excluded.login,
      scopes = excluded.scopes,
      token_ciphertext = excluded.token_ciphertext,
      token_iv = excluded.token_iv,
      token_tag = excluded.token_tag,
      updated_at = excluded.updated_at`,
  ).run(
    input.userId,
    input.githubUserId,
    input.login,
    input.scopes,
    input.ciphertext,
    input.iv,
    input.tag,
    input.now,
    input.now,
  );
}

export function findGithubConnection(userId: string): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT github_user_id AS githubUserId, login, scopes, token_ciphertext AS ciphertext,
              token_iv AS iv, token_tag AS tag, connected_at AS connectedAt, updated_at AS updatedAt
       FROM github_connections WHERE user_id = ?`,
    )
    .get(userId) as any;
}

export function deleteGithubConnection(userId: string): any | undefined {
  const existing = findGithubConnection(userId);
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare("DELETE FROM github_connections WHERE user_id = ?")
    .run(userId);
  return existing;
}
