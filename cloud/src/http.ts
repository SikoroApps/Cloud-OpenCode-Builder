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
  saveProjectFile,
  findProjectFile,
  listProjectFiles,
  markProjectFileCommitted,
  recordProjectCommit,
  listProjectCommits,
  saveBuild,
  findBuild,
  listBuilds,
  updateBuild,
  findProjectById,
  saveBuildDownloadGrant,
  findBuildDownloadGrant,
  deleteBuildDownloadGrant,
  saveImage,
  findImage,
  listImages,
  insertCloudTask,
  findCloudTask,
  listCloudTasks,
  updateCloudTaskStatus,
} from "./db.ts";
import { loadConfig, type CloudConfig, type GithubConfig } from "./config.ts";
import { getConfigReadiness, type ReadinessCloudContext } from "./readiness.ts";
import { createGithubService, decryptToken, encryptToken, hasRequiredGithubScopes, isGithubConfigured, type GithubService } from "./github.ts";
import {
  createDefaultAiFilePlanner,
  validateFilePath,
  validateFileContent,
  type AiFilePlanner,
} from "./files.ts";
import { findZipFileByExtension } from "./zip.ts";
import { verifyApkEvidence } from "./apk-evidence.ts";
import {
  createImageAnalysisService,
  createImageGenerationService,
  validateImageUpload,
  ImageServiceError,
  IMAGE_GENERATION_SIZES,
  MAX_IMAGE_BYTES,
  type ImageAnalysisService,
  type ImageGenerationService,
  type ImageGenerationSize,
} from "./images.ts";
import { createWebSearchService, WebSearchError, type WebSearchService } from "./web-search.ts";
import { cloudTaskDto, isCloudTaskStatus, validateTaskDescription } from "./tasks.ts";
import {
  clientIpFromRequest,
  createFixedWindowRateLimiter,
  RATE_LIMIT_POLICIES,
  selectRateLimitPolicy,
  type RateLimiter,
} from "./rate-limit.ts";

export interface AuthUser { id: string; email: string }

export interface ApiDependencies {
  githubConfig: GithubConfig;
  githubService: GithubService;
  aiFilePlanner: AiFilePlanner;
  publicBaseUrl?: string;
  readinessCloud?: ReadinessCloudContext;
  imageAnalysisService?: ImageAnalysisService;
  imageGenerationService?: ImageGenerationService;
  webSearchService?: WebSearchService;
  rateLimiter?: RateLimiter;
  rateLimitEnabled?: boolean;
  rateLimitTrustProxy?: boolean;
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

const MAX_IMAGE_JSON_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100_000;

export function createApiDependencies(config: CloudConfig = loadConfig()): ApiDependencies {
  return {
    githubConfig: config.github,
    githubService: createGithubService(config.github),
    aiFilePlanner: createDefaultAiFilePlanner(),
    publicBaseUrl: config.baseUrl,
    readinessCloud: {
      baseUrl: config.baseUrl,
      openRouterApiKeySet: Boolean(config.openRouterApiKey),
      openCodeApiKeySet: Boolean(config.openCodeApiKey),
    },
    imageAnalysisService: createImageAnalysisService({ openRouterApiKey: config.openRouterApiKey }),
    imageGenerationService: createImageGenerationService(),
    webSearchService: createWebSearchService(),
    rateLimiter: config.rateLimitEnabled ? createFixedWindowRateLimiter() : undefined,
    rateLimitEnabled: config.rateLimitEnabled,
    rateLimitTrustProxy: config.trustProxy,
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
  try {
    await handleApiRequestInner(req, res, deps);
  } catch (error) {
    if (res.headersSent) throw error;
    sendFeatureError(res, error);
  }
}

async function handleApiRequestInner(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDependencies,
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
    if (!applyRateLimit(req, res, deps, RATE_LIMIT_POLICIES.auth, null)) return;
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
    if (!applyRateLimit(req, res, deps, RATE_LIMIT_POLICIES.auth, null)) return;
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
  const browserArtifactDownload = req.method === "GET" && path === "/api/projects/build/artifact" && url.searchParams.has("grant");
  if (!auth.userId && !browserArtifactDownload) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (
    path.startsWith("/api/") &&
    !applyRateLimit(req, res, deps, selectRateLimitPolicy(path, req.method), auth.userId)
  ) {
    return;
  }
  if (req.method === "GET" && path === "/api/config/readiness") {
    const cloud: ReadinessCloudContext = deps.readinessCloud || {
      baseUrl: String(deps.publicBaseUrl || "http://localhost:8080"),
      openRouterApiKeySet: false,
      openCodeApiKeySet: false,
    };
    sendJson(res, 200, { readiness: getConfigReadiness(deps.githubConfig, cloud) });
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
    try {
      const body = await readJson(req);
      const sessionKey = String(body?.sessionKey || "default");
      const content = String(body?.content || "");
      if (!content.trim() || content.length > 20_000 || sessionKey.length > 200) {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }
      const webSearchService = deps.webSearchService ?? createWebSearchService();
      const search = body?.webSearch === true
        ? await webSearchService.search({ query: content, limit: 5 })
        : undefined;
      const { userMessage, assistantMessage, ai } = await runAssistantTurn({
        userId: auth.userId,
        sessionKey,
        content,
        search: search ? { query: search.query, results: search.results } : undefined,
      });
      sendJson(res, 200, {
        userMessage,
        assistantMessage,
        ai,
        webSearch: search ? { provider: search.provider, results: search.results } : null,
      });
    } catch (error) {
      sendFeatureError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/images") {
    try {
      const body = await readJson(req, MAX_IMAGE_JSON_BYTES);
      const projectId = optionalProjectId(auth.userId, body?.projectId);
      const validated = validateImageUpload({
        dataBase64: body?.dataBase64,
        mimeType: body?.mimeType,
        filename: body?.filename,
      });
      const imageId = randomUUID();
      saveImage({
        id: imageId,
        userId: auth.userId,
        projectId,
        filename: validated.filename,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
        dataBase64: validated.dataBase64,
        source: "upload",
        prompt: null,
        now: Date.now(),
      });
      sendJson(res, 201, { image: imageDto(findImage(auth.userId, imageId)) });
    } catch (error) {
      sendFeatureError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/images") {
    const images = listImages(auth.userId, url.searchParams.get("projectId"), Number(url.searchParams.get("limit") || 50));
    sendJson(res, 200, { images: images.map(imageDto) });
    return;
  }
  if (req.method === "POST" && path === "/api/images/generate") {
    try {
      const body = await readJson(req);
      const prompt = String(body?.prompt || "").trim();
      if (!prompt || prompt.length > 2000) throw new ApiRequestError(400, "invalid_request");
      const size = Number(body?.size ?? 1024) as ImageGenerationSize;
      if (!(IMAGE_GENERATION_SIZES as readonly number[]).includes(size)) {
        throw new ApiRequestError(400, "invalid_image_size");
      }
      const projectId = optionalProjectId(auth.userId, body?.projectId);
      const generator = deps.imageGenerationService ?? createImageGenerationService();
      const generated = await generator.generate({ prompt, size });
      const validated = validateImageUpload({
        dataBase64: generated.bytes.toString("base64"),
        mimeType: generated.mimeType,
        filename: `generated-${Date.now()}.${generated.mimeType.split("/")[1] === "jpeg" ? "jpg" : generated.mimeType.split("/")[1]}`,
      });
      const imageId = randomUUID();
      saveImage({
        id: imageId,
        userId: auth.userId,
        projectId,
        filename: validated.filename,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
        dataBase64: validated.dataBase64,
        source: "generated",
        prompt,
        now: Date.now(),
      });
      sendJson(res, 201, { image: imageDto(findImage(auth.userId, imageId)), prompt, size });
    } catch (error) {
      sendFeatureError(res, error);
    }
    return;
  }
  const imageContentMatch = path.match(/^\/api\/images\/([^/]+)\/content$/);
  if (req.method === "GET" && imageContentMatch) {
    try {
      const image = findImage(auth.userId, decodePathSegment(imageContentMatch[1]));
      if (!image) throw new ApiRequestError(404, "image_not_found");
      const bytes = Buffer.from(String(image.dataBase64), "base64");
      res.writeHead(200, {
        "Content-Type": String(image.mimeType),
        "Content-Length": bytes.length,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${String(image.filename).replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      });
      res.end(bytes);
    } catch (error) {
      sendFeatureError(res, error);
    }
    return;
  }
  const imageAnalyzeMatch = path.match(/^\/api\/images\/([^/]+)\/analyze$/);
  if (req.method === "POST" && imageAnalyzeMatch) {
    try {
      const image = findImage(auth.userId, decodePathSegment(imageAnalyzeMatch[1]));
      if (!image) throw new ApiRequestError(404, "image_not_found");
      const body = await readJson(req);
      const prompt = String(body?.prompt || "Describe this image and note anything relevant for an Android app project.").trim();
      if (!prompt || prompt.length > 4000) throw new ApiRequestError(400, "invalid_request");
      const analyzer = deps.imageAnalysisService ?? createImageAnalysisService();
      const analysis = await analyzer.analyze({
        bytes: Buffer.from(String(image.dataBase64), "base64"),
        mimeType: String(image.mimeType),
        prompt,
      });
      sendJson(res, 200, {
        imageId: String(image.id),
        model: analysis.model,
        content: analysis.content,
        prompt,
      });
    } catch (error) {
      sendFeatureError(res, error);
    }
    return;
  }
  const imageMatch = path.match(/^\/api\/images\/([^/]+)$/);
  if (req.method === "GET" && imageMatch) {
    const image = findImage(auth.userId, decodePathSegment(imageMatch[1]));
    if (!image) {
      sendJson(res, 404, { error: "image_not_found" });
      return;
    }
    sendJson(res, 200, { image: imageDto(image) });
    return;
  }
  if (req.method === "POST" && path === "/api/search") {
    try {
      const body = await readJson(req);
      const searchService = deps.webSearchService ?? createWebSearchService();
      const result = await searchService.search({ query: body?.query, limit: body?.limit });
      sendJson(res, 200, result);
    } catch (error) {
      sendFeatureError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/tasks") {
    try {
      const body = await readJson(req);
      const description = validateTaskDescription(body?.description);
      const projectId = optionalProjectId(auth.userId, body?.projectId);
      const taskId = randomUUID();
      insertCloudTask({
        id: taskId,
        userId: auth.userId,
        projectId,
        description,
        status: "queued",
        now: Date.now(),
      });
      sendJson(res, 201, { task: cloudTaskDto(findCloudTask(auth.userId, taskId)) });
    } catch (error) {
      sendFeatureError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/tasks") {
    const tasks = listCloudTasks(
      auth.userId,
      url.searchParams.get("projectId"),
      Number(url.searchParams.get("limit") || 50),
    );
    sendJson(res, 200, { tasks: tasks.map(cloudTaskDto) });
    return;
  }
  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && (req.method === "GET" || req.method === "PATCH" || req.method === "DELETE")) {
    try {
      const taskId = decodePathSegment(taskMatch[1]);
      const task = findCloudTask(auth.userId, taskId);
      if (!task) throw new ApiRequestError(404, "task_not_found");
      if (req.method === "GET") {
        sendJson(res, 200, { task: cloudTaskDto(task) });
        return;
      }
      if (req.method === "DELETE") {
        const updated = updateCloudTaskStatus(auth.userId, taskId, "cancelled", Date.now());
        sendJson(res, 200, { task: cloudTaskDto(updated) });
        return;
      }
      const body = await readJson(req);
      if (!isCloudTaskStatus(body?.status)) throw new ApiRequestError(400, "invalid_task_status");
      const updated = updateCloudTaskStatus(auth.userId, taskId, body.status, Date.now());
      sendJson(res, 200, { task: cloudTaskDto(updated) });
    } catch (error) {
      sendFeatureError(res, error);
    }
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
  if (req.method === "POST" && path === "/api/github/repositories/connect") {
    try {
      const { token } = requireGithubAccess(auth.userId, deps);
      const body = await readJson(req);
      const repoFullName = String(body?.repoFullName || "");
      if (!/^[^\s/]+\/[^\s/]+$/.test(repoFullName)) throw new ApiRequestError(400, "invalid_request");
      const [owner, repo] = repoFullName.split("/");
      const repository = await deps.githubService.getRepository(token, { owner, repo });
      const permissions = repository.permissions;
      const canWrite = Boolean(permissions?.admin || permissions?.maintain || permissions?.push);
      if (!canWrite) throw new ApiRequestError(403, "insufficient_repository_permissions");
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
        now: Date.now(),
      });
      selectProject(auth.userId, projectId, Date.now());
      sendJson(res, 200, {
        repository: repositoryDto(repository),
        project: projectDto(findProjectByRepo(auth.userId, repository.fullName)),
        permissions: permissionsDto(permissions),
      });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/github/permissions") {
    try {
      const { token, scopes } = requireGithubAccess(auth.userId, deps);
      const selected = findSelectedProject(auth.userId);
      const repoFullName = url.searchParams.get("repoFullName") || String(selected?.repoFullName || "");
      if (!/^[^\s/]+\/[^\s/]+$/.test(repoFullName)) throw new ApiRequestError(409, "project_not_selected");
      const [owner, repo] = repoFullName.split("/");
      const repository = await deps.githubService.getRepository(token, { owner, repo });
      const permissions = permissionsDto(repository.permissions);
      const canWrite = Boolean(permissions.admin || permissions.maintain || permissions.push);
      const workflowScope = scopes.split(/\s+/).includes("workflow");
      sendJson(res, 200, {
        repository: repository.fullName,
        isPrivate: repository.isPrivate,
        permissions,
        canWrite,
        workflowScope,
        connectedScopes: scopes,
        verified: canWrite && workflowScope,
      });
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
  if (req.method === "GET" && path === "/api/projects/files") {
    try {
      const { project } = requireSelectedProject(auth.userId, deps);
      sendJson(res, 200, { files: listProjectFiles(String(project.id)).map(fileDto) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "PUT" && path === "/api/projects/files") {
    try {
      const { project } = requireSelectedProject(auth.userId, deps);
      const body = await readJson(req);
      const filePath = validatedPath(body?.path);
      const content = validatedContent(body?.content);
      saveProjectFile({ projectId: String(project.id), path: filePath, content, now: Date.now() });
      sendJson(res, 200, { file: fileDto(findProjectFile(String(project.id), filePath)) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/file") {
    try {
      const { project } = requireSelectedProject(auth.userId, deps);
      const filePath = validatedPath(url.searchParams.get("path") || "");
      const file = findProjectFile(String(project.id), filePath);
      if (!file) throw new ApiRequestError(404, "file_not_found");
      sendJson(res, 200, { file: fileDto(file) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/projects/ai-files") {
    try {
      const { project } = requireSelectedProject(auth.userId, deps);
      const body = await readJson(req);
      const instruction = String(body?.instruction || "").trim();
      if (!instruction || instruction.length > 10_000) throw new ApiRequestError(400, "invalid_request");
      const existing = listProjectFiles(String(project.id)).map((file) => ({ path: String(file.path), content: String(file.content) }));
      const plan = await deps.aiFilePlanner({ instruction, files: existing });
      const validatedOperations = plan.operations.map((operation) => ({
        path: validatedPath(operation.path),
        content: validatedContent(operation.content),
      }));
      const now = Date.now();
      for (const operation of validatedOperations) {
        saveProjectFile({ projectId: String(project.id), path: operation.path, content: operation.content, now });
      }
      sendJson(res, 200, { model: plan.model, applied: validatedOperations.map((operation) => operation.path) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/projects/commit") {
    const body = await readJson(req);
    try {
      const { token, project } = requireSelectedProject(auth.userId, deps);
      const message = String(body?.message || "").trim();
      if (!message || message.length > 200) throw new ApiRequestError(400, "invalid_request");
      const dirtyFiles = listProjectFiles(String(project.id), true);
      if (!dirtyFiles.length) throw new ApiRequestError(400, "no_changes");
      const commitId = randomUUID();
      const owner = String(project.repoOwner);
      const repo = String(project.repoName);
      const branch = String(project.defaultBranch);
      const results: any[] = [];
      for (const file of dirtyFiles) {
        const filePath = String(file.path);
        const existing = await deps.githubService.getFile(token, { owner, repo, path: filePath, branch });
        const commit = await deps.githubService.upsertFile(token, {
          owner,
          repo,
          path: filePath,
          content: String(file.content),
          message,
          branch,
          sha: existing?.sha ?? null,
        });
        markProjectFileCommitted(String(project.id), filePath, Date.now());
        results.push({ path: filePath, sha: commit.sha, htmlUrl: commit.htmlUrl });
      }
      recordProjectCommit({
        id: commitId,
        projectId: String(project.id),
        status: "success",
        commitSha: results[0]?.sha ?? null,
        message,
        error: null,
        now: Date.now(),
      });
      sendJson(res, 200, { status: "success", commitId, files: results });
    } catch (error) {
      const project = findSelectedProject(auth.userId);
      if (project) {
        recordProjectCommit({
          id: randomUUID(),
          projectId: String(project.id),
          status: "failed",
          commitSha: null,
          message: String(body?.message || "").slice(0, 200),
          error: safeGithubError(error),
          now: Date.now(),
        });
      }
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/commits") {
    try {
      const { project } = requireSelectedProject(auth.userId, deps);
      sendJson(res, 200, { commits: listProjectCommits(String(project.id)).map(commitDto) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/projects/build-workflow") {
    try {
      const { project } = requireSelectedProject(auth.userId, deps);
      const workflowPath = ".github/workflows/android-build.yml";
      saveProjectFile({
        projectId: String(project.id),
        path: workflowPath,
        content: defaultBuildWorkflow(),
        now: Date.now(),
      });
      sendJson(res, 200, { file: fileDto(findProjectFile(String(project.id), workflowPath)) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/projects/builds") {
    try {
      const { token, project } = requireSelectedProject(auth.userId, deps);
      const body = await readJson(req);
      const workflowPath = String(body?.workflowPath || ".github/workflows/android-build.yml");
      const ref = String(body?.ref || String(project.defaultBranch));
      if (!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(workflowPath) || !/^[A-Za-z0-9_./-]{1,200}$/.test(ref)) {
        throw new ApiRequestError(400, "invalid_request");
      }
      await deps.githubService.dispatchWorkflow(token, {
        owner: String(project.repoOwner),
        repo: String(project.repoName),
        workflowPath,
        ref,
      });
      const buildId = randomUUID();
      saveBuild({
        id: buildId,
        projectId: String(project.id),
        status: "queued",
        conclusion: null,
        progress: 0,
        workflowPath,
        ref,
        runId: null,
        runUrl: null,
        logsUrl: null,
        error: null,
        now: Date.now(),
      });
      sendJson(res, 201, { build: buildDto(findBuild(buildId)) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/builds") {
    try {
      const { project } = requireSelectedProject(auth.userId, deps);
      sendJson(res, 200, { builds: listBuilds(String(project.id)).map(buildDto) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/build") {
    try {
      const build = requireBuild(auth.userId, deps, url.searchParams.get("buildId") || "");
      sendJson(res, 200, { build: buildDto(build) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/projects/build/refresh") {
    try {
      const build = await refreshBuild(auth.userId, deps, (await readJson(req))?.buildId);
      sendJson(res, 200, { build: buildDto(build) });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/build/logs") {
    try {
      const { token, project } = requireSelectedProject(auth.userId, deps);
      const build = requireBuildForProject(auth.userId, deps, url.searchParams.get("buildId") || "", String(project.id));
      if (!build.runId) throw new ApiRequestError(409, "build_not_started");
      const jobs = await deps.githubService.listWorkflowJobs(token, {
        owner: String(project.repoOwner),
        repo: String(project.repoName),
        runId: Number(build.runId),
      });
      const failedSteps = jobs.flatMap((job) => job.steps
        .filter((step) => step.conclusion === "failure")
        .map((step) => ({ job: job.name, step: step.name })));
      sendJson(res, 200, {
        buildId: String(build.id),
        runId: Number(build.runId),
        status: String(build.status),
        conclusion: build.conclusion ? String(build.conclusion) : null,
        logsUrl: build.runUrl ? String(build.runUrl) : "",
        jobs: jobs.map(jobDto),
        failedSteps,
      });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/build/verification") {
    try {
      const build = requireBuild(auth.userId, deps, url.searchParams.get("buildId") || "");
      if (!build.runId) {
        sendJson(res, 200, {
          buildId: String(build.id),
          verified: false,
          reason: "dispatch_only",
          status: String(build.status),
          conclusion: build.conclusion ? String(build.conclusion) : null,
          note: "Dispatch acceptance is not a successful build; a real completed run is required.",
        });
        return;
      }
      const { token, project } = requireSelectedProject(auth.userId, deps);
      const run = await deps.githubService.getWorkflowRun(token, {
        owner: String(project.repoOwner),
        repo: String(project.repoName),
        runId: Number(build.runId),
      });
      const jobs = await deps.githubService.listWorkflowJobs(token, {
        owner: String(project.repoOwner),
        repo: String(project.repoName),
        runId: run.id,
      });
      const failedSteps = jobs.flatMap((job) => job.steps
        .filter((step) => step.conclusion === "failure")
        .map((step) => ({ job: job.name, step: step.name })));
      const allJobsCompleted = jobs.length > 0 && jobs.every((job) => job.status === "completed");
      const dispatchMatches = run.event === "workflow_dispatch" && run.headBranch === String(build.ref);
      const verified = run.status === "completed" && run.conclusion === "success"
        && allJobsCompleted && failedSteps.length === 0 && dispatchMatches;
      sendJson(res, 200, {
        buildId: String(build.id),
        runId: run.id,
        runUrl: run.htmlUrl,
        status: run.status,
        conclusion: run.conclusion,
        expectedWorkflow: String(build.workflowPath),
        expectedRef: String(build.ref),
        actualEvent: run.event,
        actualBranch: run.headBranch,
        dispatchMatches,
        allJobsCompleted,
        jobs: jobs.map(jobDto),
        failedSteps,
        verified,
        note: "Verified only from a completed successful GitHub Actions run with all jobs complete.",
      });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/build/artifacts") {
    try {
      const { token, project } = requireSelectedProject(auth.userId, deps);
      const build = requireSuccessfulBuild(auth.userId, deps, url.searchParams.get("buildId") || "");
      const artifacts = await deps.githubService.listWorkflowArtifacts(token, {
        owner: String(project.repoOwner),
        repo: String(project.repoName),
        runId: Number(build.runId),
      });
      sendJson(res, 200, {
        buildId: String(build.id),
        runId: Number(build.runId),
        artifacts: artifacts.map((artifact) => ({
          id: artifact.id,
          name: artifact.name,
          sizeInBytes: artifact.sizeInBytes,
          expired: artifact.expired,
          createdAt: artifact.createdAt,
          downloadUrl: `/api/projects/build/artifact?buildId=${encodeURIComponent(String(build.id))}&artifactId=${artifact.id}`,
          browserUrl: artifact.htmlUrl || String(build.runUrl || ""),
        })),
      });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/projects/build/artifact/link") {
    try {
      const { token, project } = requireSelectedProject(String(auth.userId), deps);
      const body = await readJson(req);
      const build = requireSuccessfulBuild(String(auth.userId), deps, body?.buildId);
      const artifactId = Number(body?.artifactId);
      if (!Number.isFinite(artifactId) || artifactId <= 0) throw new ApiRequestError(400, "invalid_request");
      const artifacts = await deps.githubService.listWorkflowArtifacts(token, {
        owner: String(project.repoOwner),
        repo: String(project.repoName),
        runId: Number(build.runId),
      });
      if (!artifacts.some((artifact) => artifact.id === artifactId)) throw new ApiRequestError(404, "artifact_not_found");
      const grant = randomBytes(32).toString("base64url");
      const tokenHash = createHashHex(grant);
      const now = Date.now();
      const expiresIn = 10 * 60 * 1000;
      const expiresAt = now + expiresIn;
      saveBuildDownloadGrant({
        tokenHash,
        userId: String(auth.userId),
        buildId: String(build.id),
        artifactId,
        now,
        expiresAt,
      });
      const relativeUrl = `/api/projects/build/artifact?buildId=${encodeURIComponent(String(build.id))}&artifactId=${artifactId}&grant=${encodeURIComponent(grant)}`;
      const base = String(deps.publicBaseUrl || "http://localhost:8080").replace(/\/+$/, "");
      sendJson(res, 200, { url: base + relativeUrl, downloadUrl: relativeUrl, expiresAt, expiresIn });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/build/apk-verification") {
    try {
      const { token, project } = requireSelectedProject(auth.userId, deps);
      const build = requireSuccessfulBuild(auth.userId, deps, url.searchParams.get("buildId") || "");
      const artifactId = Number(url.searchParams.get("artifactId") || "");
      if (!Number.isFinite(artifactId) || artifactId <= 0) throw new ApiRequestError(400, "invalid_request");
      const artifacts = await deps.githubService.listWorkflowArtifacts(token, {
        owner: String(project.repoOwner),
        repo: String(project.repoName),
        runId: Number(build.runId),
      });
      const apkArtifact = artifacts.find((artifact) => artifact.id === artifactId);
      if (!apkArtifact) throw new ApiRequestError(404, "artifact_not_found");
      const evidenceArtifact = artifacts.find((artifact) => artifact.id !== artifactId && /evidence/i.test(artifact.name));
      if (!evidenceArtifact) throw new ApiRequestError(409, "evidence_artifact_not_found");

      const apkZip = await deps.githubService.downloadWorkflowArtifact(token, {
        owner: String(project.repoOwner),
        repo: String(project.repoName),
        artifactId,
      });
      const apkEntry = findZipFileByExtension(apkZip.bytes, ".apk");
      if (!apkEntry) throw new ApiRequestError(404, "apk_not_found");

      const evidenceZip = await deps.githubService.downloadWorkflowArtifact(token, {
        owner: String(project.repoOwner),
        repo: String(project.repoName),
        artifactId: evidenceArtifact.id,
      });
      const evidenceEntry = findZipFileByExtension(evidenceZip.bytes, ".txt")
        || findZipFileByExtension(evidenceZip.bytes, ".log");
      if (!evidenceEntry) throw new ApiRequestError(404, "evidence_not_found");
      const result = verifyApkEvidence(apkEntry.content, Buffer.from(evidenceEntry.content).toString("utf8"));
      sendJson(res, 200, {
        buildId: String(build.id),
        runId: Number(build.runId),
        artifactId,
        evidenceArtifactId: evidenceArtifact.id,
        evidenceFilename: evidenceEntry.filename.split("/").pop() || evidenceEntry.filename,
        filename: apkEntry.filename.split("/").pop() || "app.apk",
        ...result,
        note: "Signature and checksum are verified only from GitHub Actions evidence for a successful run.",
      });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/build/artifact/checksum") {
    try {
      const build = requireSuccessfulBuild(auth.userId, deps, url.searchParams.get("buildId") || "");
      const artifactId = Number(url.searchParams.get("artifactId") || "");
      if (!Number.isFinite(artifactId) || artifactId <= 0) throw new ApiRequestError(400, "invalid_request");
      const apk = await resolveApkArtifact(auth.userId, deps, build, artifactId);
      sendJson(res, 200, {
        buildId: String(build.id),
        runId: Number(build.runId),
        artifactId,
        filename: apk.filename,
        sizeInBytes: apk.bytes.length,
        sha256: apk.sha256,
        note: "SHA-256 of the APK extracted from the GitHub Actions artifact.",
      });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "GET" && path === "/api/projects/build/artifact") {
    try {
      const rawGrant = url.searchParams.get("grant") || "";
      let userId = String(auth.userId || "");
      let build: any;
      let artifactId = Number(url.searchParams.get("artifactId") || "");
      let grantHash = "";
      if (rawGrant) {
        grantHash = createHashHex(rawGrant);
        const record = findBuildDownloadGrant(grantHash, Date.now());
        if (!record) throw new ApiRequestError(403, "invalid_download_grant");
        userId = String(record.userId);
        build = findBuild(String(record.buildId));
        artifactId = Number(record.artifactId);
        if (!build) throw new ApiRequestError(404, "build_not_found");
      } else {
        if (!userId) throw new ApiRequestError(401, "unauthorized");
        build = requireSuccessfulBuild(userId, deps, url.searchParams.get("buildId") || "");
      }
      if (build.status !== "completed" || build.conclusion !== "success") throw new ApiRequestError(409, "build_not_successful");
      if (!build.runId) throw new ApiRequestError(409, "build_not_started");
      if (!Number.isFinite(artifactId) || artifactId <= 0) throw new ApiRequestError(400, "invalid_request");
      const apk = await resolveApkArtifact(userId, deps, build, artifactId);
      if (grantHash) deleteBuildDownloadGrant(grantHash);
      res.writeHead(200, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": `attachment; filename="${apk.filename}"`,
        "Content-Length": apk.bytes.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-APK-Sha256": apk.sha256,
      });
      res.end(apk.bytes);
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/projects/launcher-icon") {
    try {
      const { project } = requireSelectedProject(auth.userId, deps);
      const now = Date.now();
      const paths = Object.keys(launcherIconFiles());
      for (const filePath of paths) {
        saveProjectFile({
          projectId: String(project.id),
          path: filePath,
          content: launcherIconFiles()[filePath],
          now,
        });
      }
      sendJson(res, 200, { files: paths, message: "Launcher icon files saved; commit them before building" });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  if (req.method === "POST" && path === "/api/projects/signed-release-workflow") {
    try {
      const { project } = requireSelectedProject(auth.userId, deps);
      const workflowPath = ".github/workflows/android-release.yml";
      const now = Date.now();
      const existingIgnore = findProjectFile(String(project.id), ".gitignore");
      const ignoreLines = new Set(String(existingIgnore?.content || "").split(/\r?\n/).filter(Boolean));
      ignoreLines.add("*.jks");
      ignoreLines.add("*.keystore");
      saveProjectFile({
        projectId: String(project.id),
        path: ".gitignore",
        content: [...ignoreLines].join("\n") + "\n",
        now,
      });
      saveProjectFile({
        projectId: String(project.id),
        path: workflowPath,
        content: signedReleaseWorkflow(),
        now,
      });
      sendJson(res, 200, {
        file: fileDto(findProjectFile(String(project.id), workflowPath)),
        requiredSecrets: SIGNING_SECRET_NAMES,
        note: "Set these as GitHub Actions secrets in the selected repository; no values are stored here.",
      });
    } catch (error) {
      sendGithubError(res, error);
    }
    return;
  }
  sendJson(res, 404, { error: "not_found" });
}

function requireBuildForProject(userId: string, deps: ApiDependencies, buildId: string, projectId: string): any {
  const build = findBuild(buildId);
  if (!build || String(build.projectId) !== projectId) throw new ApiRequestError(404, "build_not_found");
  return build;
}

function requireBuild(userId: string, deps: ApiDependencies, buildId: string): any {
  const { project } = requireSelectedProject(userId, deps);
  return requireBuildForProject(userId, deps, buildId, String(project.id));
}

function requireSuccessfulBuild(userId: string, deps: ApiDependencies, buildId: string): any {
  const build = requireBuild(userId, deps, buildId);
  if (build.status !== "completed" || build.conclusion !== "success") {
    throw new ApiRequestError(409, "build_not_successful");
  }
  if (!build.runId) throw new ApiRequestError(409, "build_not_started");
  return build;
}

async function resolveApkArtifact(
  userId: string,
  deps: ApiDependencies,
  build: any,
  artifactId: number,
): Promise<{ filename: string; bytes: Buffer; sha256: string }> {
  const project = findProjectById(userId, String(build.projectId));
  if (!project) throw new ApiRequestError(404, "project_not_found");
  const { token } = requireGithubAccess(userId, deps);
  const artifact = await deps.githubService.downloadWorkflowArtifact(token, {
    owner: String(project.repoOwner),
    repo: String(project.repoName),
    artifactId,
  });
  const apk = findZipFileByExtension(artifact.bytes, ".apk");
  if (!apk) throw new ApiRequestError(404, "apk_not_found");
  const bytes = Buffer.from(apk.content);
  return {
    filename: apk.filename.split("/").pop()?.replace(/[^A-Za-z0-9._-]/g, "_") || "app.apk",
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function refreshBuild(userId: string, deps: ApiDependencies, rawBuildId: unknown): Promise<any> {
  const { token, project } = requireSelectedProject(userId, deps);
  const buildId = String(rawBuildId || "");
  const build = requireBuildForProject(userId, deps, buildId, String(project.id));
  const owner = String(project.repoOwner);
  const repo = String(project.repoName);
  let run;
  if (build.runId) {
    run = await deps.githubService.getWorkflowRun(token, { owner, repo, runId: Number(build.runId) });
  } else {
    const runs = await deps.githubService.listWorkflowRuns(token, {
      owner,
      repo,
      workflowPath: String(build.workflowPath),
      ref: String(build.ref),
      createdAfter: Number(build.createdAt),
    });
    run = runs[0];
  }
  if (!run) return findBuild(buildId);
  const jobs = await deps.githubService.listWorkflowJobs(token, { owner, repo, runId: run.id });
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const progress = jobs.length
    ? Math.round((completedJobs / jobs.length) * 100)
    : run.status === "completed" ? 100 : 10;
  const status = run.status === "completed" ? "completed" : "in_progress";
  const conclusion = run.status === "completed" ? (run.conclusion || "unknown") : null;
  const error = status === "completed" && conclusion !== "success" ? `build_${conclusion}` : null;
  updateBuild({
    id: buildId,
    status,
    conclusion,
    progress,
    runId: run.id,
    runUrl: run.htmlUrl,
    logsUrl: run.htmlUrl,
    error,
    now: Date.now(),
  });
  return findBuild(buildId);
}

function requireSelectedProject(userId: string, deps: ApiDependencies): { token: string; project: any } {
  const { token } = requireGithubAccess(userId, deps);
  const project = findSelectedProject(userId);
  if (!project) throw new ApiRequestError(409, "project_not_selected");
  return { token, project };
}

function validatedPath(rawPath: unknown): string {
  try {
    return validateFilePath(String(rawPath || ""));
  } catch (error) {
    const code = (error as Error)?.message;
    const safeCode = code === "unsupported_file_type" || code === "protected_file_path"
      ? code
      : "invalid_file_path";
    throw new ApiRequestError(400, safeCode);
  }
}

function validatedContent(content: unknown): string {
  if (typeof content !== "string") throw new ApiRequestError(400, "invalid_file_content");
  try {
    return validateFileContent(content);
  } catch (error) {
    const code = (error as Error)?.message;
    throw new ApiRequestError(400, code === "sensitive_content_rejected" ? code : "invalid_file_content");
  }
}

const SAFE_ERROR_CODES = new Set([
  "invalid_ai_file_plan",
  "invalid_file_path",
  "invalid_file_content",
  "protected_file_path",
  "sensitive_content_rejected",
  "unsupported_file_type",
  "file_read_transport_failed",
  "file_read_failed",
  "file_read_invalid_response",
  "file_commit_transport_failed",
  "file_commit_failed",
  "file_commit_invalid_response",
]);

function safeGithubError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.code;
  const candidate = error as { code?: unknown; message?: unknown };
  const isSafeCode = (value: unknown): value is string =>
    typeof value === "string" && (SAFE_ERROR_CODES.has(value) || /^(github_|repository_|file_|workflow_|invalid_ai_|unsupported_file_)/.test(value));
  if (isSafeCode(candidate?.code)) return candidate.code;
  if (isSafeCode(candidate?.message)) return candidate.message;
  return "internal_error";
}

function requireGithubAccess(userId: string, deps: ApiDependencies): { token: string; login: string; scopes: string } {
  if (!isGithubConfigured(deps.githubConfig)) throw new ApiRequestError(503, "github_not_configured");
  const connection = findGithubConnection(userId);
  if (!connection) throw new ApiRequestError(409, "github_not_connected");
  const token = decryptToken({
    ciphertext: String(connection.ciphertext),
    iv: String(connection.iv),
    tag: String(connection.tag),
  }, deps.githubConfig.tokenEncryptionKey!);
  return { token, login: String(connection.login), scopes: String(connection.scopes || "") };
}

function sendFeatureError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiRequestError) {
    sendJson(res, error.status, { error: error.code });
    return;
  }
  if (error instanceof ImageServiceError) {
    sendJson(res, error.status, { error: error.code });
    return;
  }
  if (error instanceof WebSearchError) {
    sendJson(res, error.status, { error: error.code });
    return;
  }
  const message = String((error as Error)?.message || "");
  if (message === "invalid_task_description" || message === "invalid_task_status") {
    sendJson(res, 400, { error: message });
    return;
  }
  throw error;
}

function decodePathSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new ApiRequestError(400, "invalid_request");
  }
}

function applyRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDependencies,
  policy: { name: string; scope: "ip" | "user"; limit: number; windowMs: number },
  userId: string | null,
): boolean {
  if (deps.rateLimitEnabled === false || !deps.rateLimiter) return true;
  const identity = policy.scope === "user" && userId
    ? `user:${userId}`
    : `ip:${clientIpFromRequest(req, deps.rateLimitTrustProxy === true)}`;
  const decision = deps.rateLimiter.check(`${policy.name}:${identity}`, policy);
  res.setHeader("X-RateLimit-Limit", String(decision.limit));
  res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(Date.now() / 1000) + decision.windowSeconds));
  if (decision.allowed) return true;
  res.setHeader("Retry-After", String(decision.retryAfterSeconds));
  sendJson(res, 429, { error: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds });
  return false;
}

function optionalProjectId(userId: string, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const projectId = String(raw);
  if (!findProjectById(userId, projectId)) throw new ApiRequestError(404, "project_not_found");
  return projectId;
}

function imageDto(image: any): Record<string, unknown> {
  if (!image) return {};
  return {
    id: String(image.id),
    projectId: image.projectId ? String(image.projectId) : null,
    filename: String(image.filename),
    mimeType: String(image.mimeType),
    sizeBytes: Number(image.sizeBytes),
    sha256: String(image.sha256),
    source: String(image.source),
    prompt: image.prompt ? String(image.prompt) : null,
    createdAt: Number(image.createdAt),
    contentUrl: `/api/images/${encodeURIComponent(String(image.id))}/content`,
    dataUrl: null,
  };
}

function sendGithubError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiRequestError) {
    sendJson(res, error.status, { error: error.code });
    return;
  }
  const code = safeGithubError(error);
  if (code !== "internal_error") {
    const status = Number((error as any)?.status);
    const safeStatus = status >= 400 && status < 500 ? status : 400;
    sendJson(res, safeStatus, { error: "github_request_failed", providerCode: code });
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
    permissions: permissionsDto(repository.permissions),
  };
}

function permissionsDto(permissions?: { admin: boolean; maintain: boolean; push: boolean; pull: boolean }): { admin: boolean; maintain: boolean; push: boolean; pull: boolean } {
  return {
    admin: Boolean(permissions?.admin),
    maintain: Boolean(permissions?.maintain),
    push: Boolean(permissions?.push),
    pull: Boolean(permissions?.pull),
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

function buildDto(build: any): Record<string, unknown> {
  return {
    id: String(build.id),
    status: String(build.status),
    conclusion: build.conclusion ? String(build.conclusion) : null,
    progress: Number(build.progress),
    workflowPath: String(build.workflowPath),
    ref: String(build.ref),
    runId: build.runId ? Number(build.runId) : null,
    runUrl: build.runUrl ? String(build.runUrl) : null,
    logsUrl: build.logsUrl ? String(build.logsUrl) : null,
    error: build.error ? String(build.error) : null,
    createdAt: Number(build.createdAt),
    updatedAt: Number(build.updatedAt),
  };
}

function jobDto(job: { id: number; name: string; status: string; conclusion: string | null; steps: { name: string; status: string; conclusion: string | null }[] }): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    steps: job.steps,
  };
}

function defaultBuildWorkflow(): string {
  return [
    "name: Android build",
    "on:",
    "  workflow_dispatch:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-java@v4",
    "        with:",
    "          distribution: temurin",
    "          java-version: '17'",
    "      - uses: android-actions/setup-android@v3",
    "      - name: Verify launcher icon",
    "        run: test -f app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
    "      - name: Assemble debug APK",
    "        run: ./gradlew assembleDebug",
    "      - name: Verify APK signature and checksum",
    "        run: |",
    "          set -euo pipefail",
    "          APK=$(find app/build/outputs/apk/debug -name '*.apk' | head -n 1)",
    "          test -n \"$APK\"",
    "          APKSIGNER=$(find \"$ANDROID_HOME/build-tools\" -type f -name apksigner | sort -V | tail -n 1)",
    "          {",
    "            echo \"=== apksigner verify --verbose ===\"",
    "            \"$APKSIGNER\" verify --verbose \"$APK\"",
    "            echo \"=== sha256sum ===\"",
    "            sha256sum \"$APK\"",
    "          } > app-debug-apk.sha256 2>&1",
    "          cat app-debug-apk.sha256",
    "      - name: Upload APK",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: app-debug-apk",
    "          path: app/build/outputs/apk/debug/*.apk",
    "      - name: Upload APK checksum evidence",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: app-debug-apk-evidence",
    "          path: app-debug-apk.sha256",
    "",
  ].join("\n");
}

const SIGNING_SECRET_NAMES = [
  "ANDROID_KEYSTORE_BASE64",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD",
];

function signedReleaseWorkflow(): string {
  return [
    "name: Android signed release",
    "on:",
    "  workflow_dispatch:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  release:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-java@v4",
    "        with:",
    "          distribution: temurin",
    "          java-version: '17'",
    "      - uses: android-actions/setup-android@v3",
    "      - name: Decode signing keystore",
    "        env:",
    "          ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}",
    "          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}",
    "          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}",
    "          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}",
    "        run: |",
    '          if [ -z "$ANDROID_KEYSTORE_BASE64" ] || [ -z "$ANDROID_KEYSTORE_PASSWORD" ] || [ -z "$ANDROID_KEY_ALIAS" ] || [ -z "$ANDROID_KEY_PASSWORD" ]; then',
    '            echo "::error::Signing secrets are not configured in repository Actions secrets"',
    "            exit 1",
    "          fi",
    "          mkdir -p app",
    "          printf '%s' \"$ANDROID_KEYSTORE_BASE64\" | base64 --decode > app/release.jks",
    "      - name: Assemble signed release APK",
    "        env:",
    "          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}",
    "          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}",
    "          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}",
    "        run: |",
    "          ./gradlew :app:assembleRelease \\",
    "            -Pandroid.injected.signing.store.file=$PWD/app/release.jks \\",
    "            -Pandroid.injected.signing.store.type=keystore \\",
    '            -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \\',
    '            -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \\',
    '            -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD"',
    "      - name: Verify signed APK signature and checksum",
    "        run: |",
    "          set -euo pipefail",
    "          APK=$(find app/build/outputs/apk/release -name '*.apk' | head -n 1)",
    "          test -n \"$APK\"",
    "          APKSIGNER=$(find \"$ANDROID_HOME/build-tools\" -type f -name apksigner | sort -V | tail -n 1)",
    "          AAPT=$(find \"$ANDROID_HOME/build-tools\" -type f -name aapt | sort -V | tail -n 1)",
    "          {",
    "            echo \"=== apksigner verify --verbose --print-certs ===\"",
    "            \"$APKSIGNER\" verify --verbose --print-certs \"$APK\"",
    "            echo \"=== aapt dump badging ===\"",
    "            \"$AAPT\" dump badging \"$APK\"",
    "            echo \"=== sha256sum ===\"",
    "            sha256sum \"$APK\"",
    "          } > apk-release-evidence.txt 2>&1",
    "          cat apk-release-evidence.txt",
    "      - name: Upload signed APK",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: app-release-signed",
    "          path: app/build/outputs/apk/release/*.apk",
    "      - name: Upload signed APK verification evidence",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: app-release-signed-evidence",
    "          path: apk-release-evidence.txt",
    "",
  ].join("\n");
}

function launcherIconFiles(): Record<string, string> {
  return {
    "app/src/main/res/values/ic_launcher_background.xml": [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<resources>",
      "    <color name=\"ic_launcher_background\">#FF1565C0</color>",
      "</resources>",
      "",
    ].join("\n"),
    "app/src/main/res/drawable/ic_launcher_foreground.xml": [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<vector xmlns:android=\"http://schemas.android.com/apk/res/android\"",
      "    android:width=\"108dp\"",
      "    android:height=\"108dp\"",
      "    android:viewportWidth=\"108\"",
      "    android:viewportHeight=\"108\">",
      "    <path",
      "        android:fillColor=\"#FFFFFFFF\"",
      "        android:pathData=\"M54,30 L74,42 L74,66 L54,78 L34,66 L34,42 Z\" />",
      "</vector>",
      "",
    ].join("\n"),
    "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml": [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<adaptive-icon xmlns:android=\"http://schemas.android.com/apk/res/android\">",
      "    <background android:drawable=\"@color/ic_launcher_background\" />",
      "    <foreground android:drawable=\"@drawable/ic_launcher_foreground\" />",
      "</adaptive-icon>",
      "",
    ].join("\n"),
  };
}

function fileDto(file: any): Record<string, unknown> {
  return {
    path: String(file.path),
    content: String(file.content),
    dirty: Boolean(file.dirty),
    updatedAt: Number(file.updatedAt),
  };
}

function commitDto(commit: any): Record<string, unknown> {
  return {
    id: String(commit.id),
    status: String(commit.status),
    commitSha: commit.commitSha ? String(commit.commitSha) : null,
    message: String(commit.message),
    error: commit.error ? String(commit.error) : null,
    createdAt: Number(commit.createdAt),
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
      if (!hasRequiredGithubScopes(exchange.scope)) {
        deps.githubService.revokeToken(exchange.accessToken).catch(() => false).finally(() => deny("insufficient_scopes"));
        return;
      }
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

async function readJson(req: IncomingMessage, maxBytes = 1_000_000): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new ApiRequestError(413, "payload_too_large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiRequestError(400, "invalid_json");
  }
}

function createHashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
