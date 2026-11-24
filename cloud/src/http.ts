import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, createUserSession, resolveUserByToken } from "./auth.ts";
import { getChatHistory, appendChatMessage, runAssistantTurn } from "./chat.ts";
import { FALLBACK_CHAIN } from "./ai.ts";
import {
  getDb,
  insertGithubState,
  findGithubState,
  deleteGithubState,
  saveGithubConnection,
  findGithubConnection,
  deleteGithubConnection,
  saveProject,
  findProjectByRepo,
  findSelectedProject,
  selectProject,
} from "./db.ts";
import { loadConfig, type CloudConfig, type GithubConfig } from "./config.ts";
import { createGithubService, decryptToken, encryptToken, isGithubConfigured, type GithubService } from "./github.ts";

export interface AuthUser { id: string; email: string }

export interface ApiDependencies {
  githubConfig: GithubConfig;
  githubService: GithubService;
}

class ApiRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export function createApiDependencies(config: CloudConfig = loadConfig()): ApiDependencies {
  return {
    githubConfig: config.github,
    githubService: createGithubService(config.github),
  };
}

export function createApiHandler(deps: ApiDependencies) {
  return (req: IncomingMessage, res: ServerResponse) => handleApiRequest(req, res, deps);
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDependencies = createApiDependencies(),
): Promise<void> {
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
  if (req.method === "GET" && path === "/api/github/oauth/callback") {
    handleGithubCallback(url, res, deps);
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
    const token = bearerToken(req);
    revokeSessionByToken(token);
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
  if (req.method === "GET" && path === "/api/github/oauth/start") {
    if (!isGithubConfigured(deps.githubConfig)) {
      sendJson(res, 503, { error: "github_not_configured" });
      return;
    }
    const state = randomBytes(32).toString("hex");
    const now = Date.now();
    insertGithubState(createHashHex(state), auth.userId, now, now + 10 * 60 * 1000);
    sendJson(res, 200, {
      authorizationUrl: deps.githubService.authorizationUrl(state),
      expiresIn: 600,
    });
    return;
  }
  if (req.method === "GET" && path === "/api/github/status") {
    const connection = findGithubConnection(auth.userId);
    sendJson(res, 200, {
      configured: isGithubConfigured(deps.githubConfig),
      connected: Boolean(connection),
      login: connection ? String(connection.login) : null,
      scopes: connection ? String(connection.scopes) : null,
      connectedAt: connection ? Number(connection.connectedAt) : null,
    });
    return;
  }
  if (req.method === "DELETE" && path === "/api/github") {
    const connection = findGithubConnection(auth.userId);
    let revoked = false;
    if (connection && isGithubConfigured(deps.githubConfig)) {
      try {
        const token = decryptToken({
          ciphertext: String(connection.ciphertext),
          iv: String(connection.iv),
          tag: String(connection.tag),
        }, deps.githubConfig.tokenEncryptionKey!);
        revoked = await deps.githubService.revokeToken(token);
      } catch {
        revoked = false;
      }
    }
    deleteGithubConnection(auth.userId);
    sendJson(res, 200, { disconnected: true, revoked });
    return;
  }
  if (req.method === "GET" && path === "/api/github/repositories") {
    try {
      const { token } = requireGithubAccess(auth.userId, deps);
      const repositories = await deps.githubService.listRepositories(token);
      sendJson(res, 200, { repositories: repositories.map(repositoryDto) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/github/repositories") {
    try {
      const { token, login } = requireGithubAccess(auth.userId, deps);
      const body = await readJson(req);
      const name = String(body?.name || "");
      const description = String(body?.description || "");
      if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name.startsWith(".") || name.startsWith("-") || description.length > 200) {
        throw new ApiRequestError(400, "invalid_request");
      }
      if (await deps.githubService.repositoryExists(token, login, name)) {
        throw new ApiRequestError(409, "repository_exists");
      }
      const repository = await deps.githubService.createRepository(token, { name, description });
      const now = Date.now();
      const projectId = randomUUID();
      saveProject({
        id: projectId,
        userId: auth.userId,
        repoId: repository.id,
        repoFullName: repository.fullName,
        repoOwner: repository.owner,
        repoName: repository.name,
        defaultBranch: repository.defaultBranch,
        htmlUrl: repository.htmlUrl,
        now,
      });
      selectProject(auth.userId, projectId, now);
      sendJson(res, 201, { repository: repositoryDto(repository), project: projectDto(findProjectByRepo(auth.userId, repository.fullName)) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/github/selection") {
    try {
      requireGithubAccess(auth.userId, deps);
      sendJson(res, 200, { project: projectDto(findSelectedProject(auth.userId)) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "PUT" && path === "/api/github/selection") {
    try {
      requireGithubAccess(auth.userId, deps);
      const body = await readJson(req);
      const repoFullName = String(body?.repoFullName || "");
      if (!/^[^\s/]+\/[^\s/]+$/.test(repoFullName)) throw new ApiRequestError(400, "invalid_request");
      const project = findProjectByRepo(auth.userId, repoFullName);
      if (!project) throw new ApiRequestError(404, "project_not_found");
      selectProject(auth.userId, String(project.id), Date.now());
      sendJson(res, 200, { project: projectDto(findSelectedProject(auth.userId)) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  sendJson(res, 404, { error: "not_found" });
}

function requireGithubAccess(userId: string, deps: ApiDependencies): { token: string; login: string } {
  if (!isGithubConfigured(deps.githubConfig)) throw new ApiRequestError(503, "github_not_configured");
  const connection = findGithubConnection(userId);
  if (!connection) throw new ApiRequestError(409, "github_not_connected");
  const token = decryptToken({
    ciphertext: String(connection.ciphertext),
    iv: String(connection.iv),
    tag: String(connection.tag),
  }, deps.githubConfig.tokenEncryptionKey!);
  return { token, login: String(connection.login) };
}

function sendGithubError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiRequestError) {
    sendJson(res, error.status, { error: error.code });
    return;
  }
  const code = (error as any)?.code;
  if (typeof code === "string" && code.startsWith("github_")) {
    sendJson(res, 400, { error: "github_request_failed", providerCode: code });
    return;
  }
  if (typeof code === "string" && code.startsWith("repository_")) {
    sendJson(res, 400, { error: "github_request_failed", providerCode: code });
    return;
  }
  throw error;
}

function repositoryDto(repository: any): Record<string, unknown> {
  return {
    id: Number(repository.id),
    fullName: String(repository.fullName),
    name: String(repository.name),
    owner: String(repository.owner),
    isPrivate: Boolean(repository.isPrivate),
    defaultBranch: String(repository.defaultBranch),
    htmlUrl: String(repository.htmlUrl),
  };
}

function projectDto(project: any | undefined): Record<string, unknown> | null {
  if (!project) return null;
  return {
    id: String(project.id),
    repoId: Number(project.repoId),
    repoFullName: String(project.repoFullName),
    repoOwner: String(project.repoOwner),
    repoName: String(project.repoName),
    defaultBranch: String(project.defaultBranch),
    htmlUrl: String(project.htmlUrl),
  };
}

function handleGithubCallback(url: URL, res: ServerResponse, deps: ApiDependencies): void {
  const deny = (error: string) => redirectToApp(res, deps.githubConfig, { error });
  if (url.searchParams.get("error")) {
    deny("github_denied");
    return;
  }
  if (!isGithubConfigured(deps.githubConfig)) {
    deny("github_not_configured");
    return;
  }
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !state) {
    deny("invalid_callback");
    return;
  }
  const stateHash = createHashHex(state);
  const stored = findGithubState(stateHash);
  if (!stored) {
    deny("invalid_state");
    return;
  }
  deleteGithubState(stateHash);
  deps.githubService.exchangeCode(code)
    .then((exchange) => deps.githubService.fetchIdentity(exchange.accessToken).then((identity) => ({ exchange, identity })))
    .then(({ exchange, identity }) => {
      const encrypted = encryptToken(exchange.accessToken, deps.githubConfig.tokenEncryptionKey!);
      saveGithubConnection({
        userId: String(stored.user_id),
        githubUserId: identity.id,
        login: identity.login,
        scopes: exchange.scope,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        now: Date.now(),
      });
      redirectToApp(res, deps.githubConfig, { status: "connected" });
    })
    .catch(() => deny("oauth_failed"));
}

function redirectToApp(res: ServerResponse, config: GithubConfig, params: Record<string, string>): void {
  const target = new URL(config.appCallbackUrl);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  res.writeHead(302, { Location: target.toString(), "Cache-Control": "no-store" });
  res.end();
}

async function authenticate(req: IncomingMessage): Promise<{ userId: string } | { userId: null }> {
  const userId = resolveUserByToken(bearerToken(req), Date.now());
  return { userId };
}

function bearerToken(req: IncomingMessage): string {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function revokeSessionByToken(token: string): void {
  const tokenHash = createHashHex(token);
  getDb(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite").prepare("UPDATE sessions SET revoked = 1 WHERE token_hash = ?").run(tokenHash);
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

function createHashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
