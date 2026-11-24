import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { GithubConfig } from "../src/config.ts";
import type { ApiDependencies } from "../src/http.ts";
import { createApiHandler } from "../src/http.ts";
import type { GithubService } from "../src/github.ts";
import type { AiFilePlanner } from "../src/files.ts";

export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export function pngBytes(): Buffer {
  return Buffer.from(PNG_BASE64, "base64");
}

export function stubGithubConfig(): GithubConfig {
  return {
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    appCallbackUrl: "cloudopencode://github/callback",
    apiBaseUrl: "https://api.github.com",
    authBaseUrl: "https://github.com",
    tokenEncryptionKey: randomBytes(32),
  };
}

export function baseDependencies(overrides: Partial<ApiDependencies> = {}): ApiDependencies {
  const githubService = {
    authorizationUrl: () => "https://github.example.invalid/authorize",
    async exchangeCode() {
      throw new Error("github is not used in this test");
    },
    async fetchIdentity() {
      throw new Error("github is not used in this test");
    },
    async revokeToken() {
      return false;
    },
    async listRepositories() {
      return [];
    },
    async getRepository() {
      throw new Error("github is not used in this test");
    },
    async repositoryExists() {
      return false;
    },
    async createRepository() {
      throw new Error("github is not used in this test");
    },
    async getFile() {
      return null;
    },
    async upsertFile() {
      throw new Error("github is not used in this test");
    },
    async dispatchWorkflow() {},
    async listWorkflowRuns() {
      return [];
    },
    async getWorkflowRun() {
      throw new Error("github is not used in this test");
    },
    async listWorkflowJobs() {
      return [];
    },
    async listWorkflowArtifacts() {
      return [];
    },
    async downloadWorkflowArtifact() {
      throw new Error("github is not used in this test");
    },
  } as unknown as GithubService;
  const aiFilePlanner: AiFilePlanner = async () => ({ model: "mock", operations: [] });
  return {
    githubConfig: stubGithubConfig(),
    githubService,
    aiFilePlanner,
    ...overrides,
  };
}

export async function startServer(dependencies: ApiDependencies): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server: Server = createServer(createApiHandler(dependencies));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export async function registerUser(baseUrl: string): Promise<Record<string, string>> {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `phase68-${Date.now()}-${randomBytes(4).toString("hex")}@example.invalid`,
      password: "password-1234",
    }),
  });
  if (response.status !== 201) throw new Error(`register failed: ${response.status}`);
  const body = await response.json() as any;
  return { Authorization: `Bearer ${String(body.token)}` };
}
