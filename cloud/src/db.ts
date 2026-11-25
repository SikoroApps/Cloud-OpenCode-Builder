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
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      repo_id INTEGER NOT NULL,
      repo_full_name TEXT NOT NULL,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      html_url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, repo_full_name)
    );
    CREATE TABLE IF NOT EXISTS project_selections (
      user_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      selected_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, path)
    );
    CREATE TABLE IF NOT EXISTS project_commits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      commit_sha TEXT,
      message TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_builds (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      conclusion TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      workflow_path TEXT NOT NULL,
      ref TEXT NOT NULL,
      run_id INTEGER,
      run_url TEXT,
      logs_url TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS build_download_grants (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      build_id TEXT NOT NULL,
      artifact_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      source TEXT NOT NULL,
      prompt TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS images_user_created ON images(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS cloud_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cloud_tasks_user_created ON cloud_tasks(user_id, created_at DESC);
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

export function saveProject(input: {
  id: string;
  userId: string;
  repoId: number;
  repoFullName: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  htmlUrl: string;
  now: number;
}): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `INSERT INTO projects
      (id, user_id, repo_id, repo_full_name, repo_owner, repo_name, default_branch, html_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
      repo_id = excluded.repo_id,
      repo_owner = excluded.repo_owner,
      repo_name = excluded.repo_name,
      default_branch = excluded.default_branch,
      html_url = excluded.html_url,
      updated_at = excluded.updated_at`,
  ).run(
    input.id,
    input.userId,
    input.repoId,
    input.repoFullName,
    input.repoOwner,
    input.repoName,
    input.defaultBranch,
    input.htmlUrl,
    input.now,
    input.now,
  );
}

export function findProjectByRepo(userId: string, repoFullName: string): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, repo_id AS repoId, repo_full_name AS repoFullName, repo_owner AS repoOwner,
              repo_name AS repoName, default_branch AS defaultBranch, html_url AS htmlUrl,
              created_at AS createdAt, updated_at AS updatedAt
       FROM projects WHERE user_id = ? AND repo_full_name = ?`,
    )
    .get(userId, repoFullName) as any;
}

export function findProjectById(userId: string, projectId: string): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, repo_id AS repoId, repo_full_name AS repoFullName, repo_owner AS repoOwner,
              repo_name AS repoName, default_branch AS defaultBranch, html_url AS htmlUrl,
              created_at AS createdAt, updated_at AS updatedAt
       FROM projects WHERE user_id = ? AND id = ?`,
    )
    .get(userId, projectId) as any;
}

export function selectProject(userId: string, projectId: string, now: number): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `INSERT INTO project_selections (user_id, project_id, selected_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET project_id = excluded.project_id, selected_at = excluded.selected_at`,
  ).run(userId, projectId, now);
}

export function findSelectedProject(userId: string): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT p.id, p.repo_id AS repoId, p.repo_full_name AS repoFullName, p.repo_owner AS repoOwner,
              p.repo_name AS repoName, p.default_branch AS defaultBranch, p.html_url AS htmlUrl,
              s.selected_at AS selectedAt
       FROM project_selections s JOIN projects p ON p.id = s.project_id WHERE s.user_id = ?`,
    )
    .get(userId) as any;
}

export function listProjects(userId: string): any[] {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, repo_id AS repoId, repo_full_name AS repoFullName, repo_owner AS repoOwner,
              repo_name AS repoName, default_branch AS defaultBranch, html_url AS htmlUrl,
              created_at AS createdAt, updated_at AS updatedAt
       FROM projects WHERE user_id = ? ORDER BY updated_at DESC`,
    )
    .all(userId) as any[];
}

export function saveProjectFile(input: { projectId: string; path: string; content: string; now: number; source?: string }): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `INSERT INTO project_files (project_id, path, content, dirty, updated_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(project_id, path) DO UPDATE SET content = excluded.content, dirty = 1, updated_at = excluded.updated_at`,
  ).run(input.projectId, input.path, input.content, input.now);
}

export function findProjectFile(projectId: string, path: string): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare("SELECT id, project_id AS projectId, path, content, dirty, updated_at AS updatedAt FROM project_files WHERE project_id = ? AND path = ?")
    .get(projectId, path) as any;
}

export function listProjectFiles(projectId: string, dirtyOnly = false): any[] {
  const suffix = dirtyOnly ? " AND dirty = 1" : "";
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(`SELECT path, content, dirty, updated_at AS updatedAt FROM project_files WHERE project_id = ?${suffix} ORDER BY path ASC`)
    .all(projectId) as any[];
}

export function markProjectFileCommitted(projectId: string, path: string, now: number): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare("UPDATE project_files SET dirty = 0, updated_at = ? WHERE project_id = ? AND path = ?")
    .run(now, projectId, path);
}

export function recordProjectCommit(input: {
  id: string;
  projectId: string;
  status: string;
  commitSha: string | null;
  message: string;
  error: string | null;
  now: number;
}): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `INSERT INTO project_commits (id, project_id, status, commit_sha, message, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.projectId, input.status, input.commitSha, input.message, input.error, input.now);
}

export function listProjectCommits(projectId: string, limit = 20): any[] {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, status, commit_sha AS commitSha, message, error, created_at AS createdAt
       FROM project_commits WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as any[];
}

export function saveBuild(input: {
  id: string;
  projectId: string;
  status: string;
  conclusion: string | null;
  progress: number;
  workflowPath: string;
  ref: string;
  runId: number | null;
  runUrl: string | null;
  logsUrl: string | null;
  error: string | null;
  now: number;
}): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `INSERT INTO project_builds
      (id, project_id, status, conclusion, progress, workflow_path, ref, run_id, run_url, logs_url, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.projectId,
    input.status,
    input.conclusion,
    input.progress,
    input.workflowPath,
    input.ref,
    input.runId,
    input.runUrl,
    input.logsUrl,
    input.error,
    input.now,
    input.now,
  );
}

export function findBuild(buildId: string): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, project_id AS projectId, status, conclusion, progress, workflow_path AS workflowPath,
              ref, run_id AS runId, run_url AS runUrl, logs_url AS logsUrl, error,
              created_at AS createdAt, updated_at AS updatedAt
       FROM project_builds WHERE id = ?`,
    )
    .get(buildId) as any;
}

export function listBuilds(projectId: string, limit = 20): any[] {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, project_id AS projectId, status, conclusion, progress, workflow_path AS workflowPath,
              ref, run_id AS runId, run_url AS runUrl, logs_url AS logsUrl, error,
              created_at AS createdAt, updated_at AS updatedAt
       FROM project_builds WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as any[];
}

export function updateBuild(input: {
  id: string;
  status: string;
  conclusion: string | null;
  progress: number;
  runId: number | null;
  runUrl: string | null;
  logsUrl: string | null;
  error: string | null;
  now: number;
}): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `UPDATE project_builds SET status = ?, conclusion = ?, progress = ?, run_id = ?, run_url = ?,
      logs_url = ?, error = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.status,
    input.conclusion,
    input.progress,
    input.runId,
    input.runUrl,
    input.logsUrl,
    input.error,
    input.now,
    input.id,
  );
}

export function saveBuildDownloadGrant(input: {
  tokenHash: string;
  userId: string;
  buildId: string;
  artifactId: number;
  now: number;
  expiresAt: number;
}): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `INSERT INTO build_download_grants
      (token_hash, user_id, build_id, artifact_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.tokenHash, input.userId, input.buildId, input.artifactId, input.now, input.expiresAt);
}

export function findBuildDownloadGrant(tokenHash: string, now: number): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT token_hash AS tokenHash, user_id AS userId, build_id AS buildId,
              artifact_id AS artifactId, expires_at AS expiresAt
       FROM build_download_grants WHERE token_hash = ? AND expires_at > ?`,
    )
    .get(tokenHash, now) as any;
}

export function deleteBuildDownloadGrant(tokenHash: string): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare("DELETE FROM build_download_grants WHERE token_hash = ?")
    .run(tokenHash);
}

/** Atomically consume an unexpired grant so concurrent requests cannot both use it. */
export function consumeBuildDownloadGrant(tokenHash: string, now: number): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `DELETE FROM build_download_grants
       WHERE token_hash = ? AND expires_at > ?
       RETURNING token_hash AS tokenHash, user_id AS userId, build_id AS buildId,
                 artifact_id AS artifactId, expires_at AS expiresAt`,
    )
    .get(tokenHash, now) as any;
}

export function saveImage(input: {
  id: string;
  userId: string;
  projectId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  dataBase64: string;
  source: string;
  prompt: string | null;
  now: number;
}): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `INSERT INTO images
      (id, user_id, project_id, filename, mime_type, size_bytes, sha256, data_base64, source, prompt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.userId,
    input.projectId,
    input.filename,
    input.mimeType,
    input.sizeBytes,
    input.sha256,
    input.dataBase64,
    input.source,
    input.prompt,
    input.now,
  );
}

export function findImage(userId: string, imageId: string): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, filename, mime_type AS mimeType,
              size_bytes AS sizeBytes, sha256, data_base64 AS dataBase64, source, prompt,
              created_at AS createdAt
       FROM images WHERE id = ? AND user_id = ?`,
    )
    .get(imageId, userId) as any;
}

function normalizeListLimit(limit: number, fallback = 50): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(Math.trunc(limit), 100));
}

export function listImages(userId: string, projectId: string | null, limit = 50): any[] {
  const normalizedLimit = normalizeListLimit(limit);
  if (projectId) {
    return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
      .prepare(
        `SELECT id, user_id AS userId, project_id AS projectId, filename, mime_type AS mimeType,
                size_bytes AS sizeBytes, sha256, source, prompt, created_at AS createdAt
         FROM images WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, projectId, normalizedLimit) as any[];
  }
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, filename, mime_type AS mimeType,
              size_bytes AS sizeBytes, sha256, source, prompt, created_at AS createdAt
       FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, normalizedLimit) as any[];
}

export function insertCloudTask(input: {
  id: string;
  userId: string;
  projectId: string | null;
  description: string;
  status: string;
  now: number;
}): void {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare(
    `INSERT INTO cloud_tasks (id, user_id, project_id, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.userId, input.projectId, input.description, input.status, input.now, input.now);
}

export function findCloudTask(userId: string, taskId: string): any | undefined {
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, description, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM cloud_tasks WHERE id = ? AND user_id = ?`,
    )
    .get(taskId, userId) as any;
}

export function listCloudTasks(userId: string, projectId: string | null, limit = 50): any[] {
  const normalizedLimit = normalizeListLimit(limit);
  if (projectId) {
    return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
      .prepare(
        `SELECT id, user_id AS userId, project_id AS projectId, description, status,
                created_at AS createdAt, updated_at AS updatedAt
         FROM cloud_tasks WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, projectId, normalizedLimit) as any[];
  }
  return getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, description, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM cloud_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, normalizedLimit) as any[];
}

export function updateCloudTaskStatus(userId: string, taskId: string, status: string, now: number): any | undefined {
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite")
    .prepare("UPDATE cloud_tasks SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(status, now, taskId, userId);
  return findCloudTask(userId, taskId);
}
