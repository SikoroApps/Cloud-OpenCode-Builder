import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { GithubConfig } from "./config.ts";

export interface GithubTokenExchange {
  accessToken: string;
  scope: string;
  tokenType: string;
}

export interface GithubIdentity {
  id: number;
  login: string;
}

export interface GithubRepository {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  isPrivate: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

export interface GithubFile {
  path: string;
  sha: string | null;
  content: string;
}

export interface GithubCommitResult {
  sha: string;
  htmlUrl: string;
}

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  createdAt: number;
  updatedAt: number;
  htmlUrl: string;
  headBranch: string;
  event: string;
}

export interface WorkflowJobStep {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface WorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps: WorkflowJobStep[];
}

export interface WorkflowArtifact {
  id: number;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  createdAt: number;
  htmlUrl: string;
}

export interface DownloadedArtifact {
  bytes: Uint8Array;
  suggestedFilename: string;
}

export interface GithubService {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<GithubTokenExchange>;
  fetchIdentity(accessToken: string): Promise<GithubIdentity>;
  revokeToken(accessToken: string): Promise<boolean>;
  listRepositories(accessToken: string): Promise<GithubRepository[]>;
  repositoryExists(accessToken: string, owner: string, name: string): Promise<boolean>;
  createRepository(accessToken: string, input: { name: string; description: string }): Promise<GithubRepository>;
  getFile(accessToken: string, input: { owner: string; repo: string; path: string; branch: string }): Promise<GithubFile | null>;
  upsertFile(accessToken: string, input: {
    owner: string;
    repo: string;
    path: string;
    content: string;
    message: string;
    branch: string;
    sha?: string | null;
  }): Promise<GithubCommitResult>;
  dispatchWorkflow(accessToken: string, input: { owner: string; repo: string; workflowPath: string; ref: string }): Promise<void>;
  listWorkflowRuns(accessToken: string, input: { owner: string; repo: string; workflowPath: string; ref: string; createdAfter: number }): Promise<WorkflowRun[]>;
  getWorkflowRun(accessToken: string, input: { owner: string; repo: string; runId: number }): Promise<WorkflowRun>;
  listWorkflowJobs(accessToken: string, input: { owner: string; repo: string; runId: number }): Promise<WorkflowJob[]>;
  listWorkflowArtifacts(accessToken: string, input: { owner: string; repo: string; runId: number }): Promise<WorkflowArtifact[]>;
  downloadWorkflowArtifact(accessToken: string, input: { owner: string; repo: string; artifactId: number }): Promise<DownloadedArtifact>;
}

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  tag: string;
}

export class GithubServiceError extends Error {
  code: string;
  status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.name = "GithubServiceError";
    this.code = code;
    this.status = status;
  }
}

export const GITHUB_OAUTH_SCOPES = "public_repo workflow";

export function isGithubConfigured(config: GithubConfig): boolean {
  return Boolean(
    config.clientId &&
    config.clientSecret &&
    /^https:\/\//.test(config.redirectUri) &&
    config.tokenEncryptionKey?.length === 32,
  );
}

export function encryptToken(token: string, key: Buffer): EncryptedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptToken(record: EncryptedToken, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function mapRepository(payload: any): GithubRepository {
  if (!Number.isFinite(Number(payload?.id)) || typeof payload?.full_name !== "string") {
    throw new GithubServiceError("repository_invalid_response");
  }
  const [owner, name] = payload.full_name.split("/");
  return {
    id: Number(payload.id),
    fullName: String(payload.full_name),
    name: String(payload.name || name || ""),
    owner: String(payload.owner?.login || owner || ""),
    isPrivate: Boolean(payload.private),
    defaultBranch: String(payload.default_branch || "main"),
    htmlUrl: String(payload.html_url || ""),
  };
}

function mapWorkflowRun(payload: any): WorkflowRun {
  if (!Number.isFinite(Number(payload?.id)) || typeof payload?.status !== "string") {
    throw new GithubServiceError("workflow_invalid_response");
  }
  return {
    id: Number(payload.id),
    status: String(payload.status),
    conclusion: typeof payload.conclusion === "string" ? payload.conclusion : null,
    createdAt: Date.parse(String(payload.created_at || "")) || 0,
    updatedAt: Date.parse(String(payload.updated_at || "")) || 0,
    htmlUrl: String(payload.html_url || ""),
    headBranch: String(payload.head_branch || ""),
    event: String(payload.event || ""),
  };
}

function mapWorkflowJob(payload: any): WorkflowJob {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  return {
    id: Number(payload?.id),
    name: String(payload?.name || ""),
    status: String(payload?.status || ""),
    conclusion: typeof payload?.conclusion === "string" ? payload.conclusion : null,
    steps: steps.map((step: any) => ({
      name: String(step?.name || ""),
      status: String(step?.status || ""),
      conclusion: typeof step?.conclusion === "string" ? step.conclusion : null,
    })),
  };
}

export function createGithubService(
  config: GithubConfig,
  fetchImpl: typeof fetch = fetch,
): GithubService {
  function apiHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "cloud-opencode-builder",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  return {
    authorizationUrl(state: string): string {
      const url = new URL("/login/oauth/authorize", config.authBaseUrl);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("scope", GITHUB_OAUTH_SCOPES);
      url.searchParams.set("state", state);
      url.searchParams.set("allow_signup", "false");
      return url.toString();
    },

    async exchangeCode(code: string): Promise<GithubTokenExchange> {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      });
      let response: Response;
      try {
        response = await fetchImpl(`${config.authBaseUrl}/login/oauth/access_token`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
      } catch {
        throw new GithubServiceError("oauth_exchange_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("oauth_exchange_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("oauth_exchange_invalid_response");
      }
      if (payload?.error || typeof payload?.access_token !== "string" || !payload.access_token) {
        throw new GithubServiceError("oauth_exchange_rejected");
      }
      return {
        accessToken: payload.access_token,
        scope: typeof payload.scope === "string" ? payload.scope : "",
        tokenType: typeof payload.token_type === "string" ? payload.token_type : "bearer",
      };
    },

    async fetchIdentity(accessToken: string): Promise<GithubIdentity> {
      let response: Response;
      try {
        response = await fetchImpl(`${config.apiBaseUrl}/user`, {
          headers: apiHeaders(accessToken),
        });
      } catch {
        throw new GithubServiceError("identity_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("identity_fetch_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("identity_invalid_response");
      }
      if (!Number.isFinite(Number(payload?.id)) || typeof payload?.login !== "string") {
        throw new GithubServiceError("identity_invalid_response");
      }
      return { id: Number(payload.id), login: payload.login };
    },

    async revokeToken(accessToken: string): Promise<boolean> {
      const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
      let response: Response;
      try {
        response = await fetchImpl(`${config.apiBaseUrl}/applications/${encodeURIComponent(config.clientId)}/token`, {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${basic}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "cloud-opencode-builder",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ access_token: accessToken }),
        });
      } catch {
        return false;
      }
      return response.ok;
    },

    async listRepositories(accessToken: string): Promise<GithubRepository[]> {
      const query = new URLSearchParams({
        per_page: "100",
        affiliation: "owner,collaborator,organization_member",
        sort: "updated",
      });
      let response: Response;
      try {
        response = await fetchImpl(`${config.apiBaseUrl}/user/repos?${query}`, {
          headers: apiHeaders(accessToken),
        });
      } catch {
        throw new GithubServiceError("repository_list_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("repository_list_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("repository_list_invalid_response");
      }
      if (!Array.isArray(payload)) throw new GithubServiceError("repository_list_invalid_response");
      return payload.map(mapRepository);
    },

    async repositoryExists(accessToken: string, owner: string, name: string): Promise<boolean> {
      const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
      let response: Response;
      try {
        response = await fetchImpl(`${config.apiBaseUrl}${path}`, { headers: apiHeaders(accessToken) });
      } catch {
        throw new GithubServiceError("repository_lookup_transport_failed");
      }
      if (response.status === 404) return false;
      if (!response.ok) throw new GithubServiceError("repository_lookup_failed", response.status);
      return true;
    },

    async createRepository(accessToken: string, input: { name: string; description: string }): Promise<GithubRepository> {
      let response: Response;
      try {
        response = await fetchImpl(`${config.apiBaseUrl}/user/repos`, {
          method: "POST",
          headers: { ...apiHeaders(accessToken), "Content-Type": "application/json" },
          body: JSON.stringify({
            name: input.name,
            description: input.description,
            private: false,
            auto_init: true,
          }),
        });
      } catch {
        throw new GithubServiceError("repository_create_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("repository_create_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("repository_create_invalid_response");
      }
      return mapRepository(payload);
    },

    async getFile(accessToken: string, input: { owner: string; repo: string; path: string; branch: string }): Promise<GithubFile | null> {
      const encodedPath = input.path.split("/").map(encodeURIComponent).join("/");
      const query = new URLSearchParams({ ref: input.branch });
      const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodedPath}?${query}`;
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: apiHeaders(accessToken) });
      } catch {
        throw new GithubServiceError("file_read_transport_failed");
      }
      if (response.status === 404) return null;
      if (!response.ok) throw new GithubServiceError("file_read_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("file_read_invalid_response");
      }
      if (typeof payload?.content !== "string") throw new GithubServiceError("file_read_invalid_response");
      return {
        path: String(payload.path || input.path),
        sha: typeof payload.sha === "string" ? payload.sha : null,
        content: Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8"),
      };
    },

    async upsertFile(accessToken: string, input: {
      owner: string;
      repo: string;
      path: string;
      content: string;
      message: string;
      branch: string;
      sha?: string | null;
    }): Promise<GithubCommitResult> {
      const encodedPath = input.path.split("/").map(encodeURIComponent).join("/");
      const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodedPath}`;
      const body: Record<string, unknown> = {
        message: input.message,
        content: Buffer.from(input.content, "utf8").toString("base64"),
        branch: input.branch,
      };
      if (input.sha) body.sha = input.sha;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "PUT",
          headers: { ...apiHeaders(accessToken), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        throw new GithubServiceError("file_commit_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("file_commit_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("file_commit_invalid_response");
      }
      if (typeof payload?.commit?.sha !== "string") throw new GithubServiceError("file_commit_invalid_response");
      return {
        sha: payload.commit.sha,
        htmlUrl: String(payload.content?.html_url || payload.commit?.html_url || ""),
      };
    },

    async dispatchWorkflow(accessToken: string, input: { owner: string; repo: string; workflowPath: string; ref: string }): Promise<void> {
      const workflowId = input.workflowPath.split("/").pop() || input.workflowPath;
      const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { ...apiHeaders(accessToken), "Content-Type": "application/json" },
          body: JSON.stringify({ ref: input.ref }),
        });
      } catch {
        throw new GithubServiceError("workflow_dispatch_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("workflow_dispatch_failed", response.status);
    },

    async listWorkflowRuns(accessToken: string, input: { owner: string; repo: string; workflowPath: string; ref: string; createdAfter: number }): Promise<WorkflowRun[]> {
      const workflowId = input.workflowPath.split("/").pop() || input.workflowPath;
      const query = new URLSearchParams({ per_page: "10" });
      const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/workflows/${encodeURIComponent(workflowId)}/runs?${query}`;
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: apiHeaders(accessToken) });
      } catch {
        throw new GithubServiceError("workflow_runs_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("workflow_runs_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("workflow_runs_invalid_response");
      }
      if (!Array.isArray(payload?.workflow_runs)) throw new GithubServiceError("workflow_runs_invalid_response");
      return payload.workflow_runs
        .map(mapWorkflowRun)
        .filter((run: WorkflowRun) =>
          run.event === "workflow_dispatch" &&
          run.headBranch === input.ref &&
          run.createdAt >= input.createdAfter - 60_000);
    },

    async getWorkflowRun(accessToken: string, input: { owner: string; repo: string; runId: number }): Promise<WorkflowRun> {
      const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.runId}`;
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: apiHeaders(accessToken) });
      } catch {
        throw new GithubServiceError("workflow_run_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("workflow_run_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("workflow_run_invalid_response");
      }
      return mapWorkflowRun(payload);
    },

    async listWorkflowJobs(accessToken: string, input: { owner: string; repo: string; runId: number }): Promise<WorkflowJob[]> {
      const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.runId}/jobs`;
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: apiHeaders(accessToken) });
      } catch {
        throw new GithubServiceError("workflow_jobs_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("workflow_jobs_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("workflow_jobs_invalid_response");
      }
      if (!Array.isArray(payload?.jobs)) throw new GithubServiceError("workflow_jobs_invalid_response");
      return payload.jobs.map(mapWorkflowJob);
    },

    async listWorkflowArtifacts(accessToken: string, input: { owner: string; repo: string; runId: number }): Promise<WorkflowArtifact[]> {
      const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.runId}/artifacts`;
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: apiHeaders(accessToken) });
      } catch {
        throw new GithubServiceError("workflow_artifacts_transport_failed");
      }
      if (!response.ok) throw new GithubServiceError("workflow_artifacts_failed", response.status);
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new GithubServiceError("workflow_artifacts_invalid_response");
      }
      if (!Array.isArray(payload?.artifacts)) throw new GithubServiceError("workflow_artifacts_invalid_response");
      return payload.artifacts
        .filter((artifact: any) => Number.isFinite(Number(artifact?.id)))
        .map((artifact: any) => ({
          id: Number(artifact.id),
          name: String(artifact.name || ""),
          sizeInBytes: Number(artifact.size_in_bytes || 0),
          expired: Boolean(artifact.expired),
          createdAt: Date.parse(String(artifact.created_at || "")) || 0,
          htmlUrl: String(artifact.html_url || artifact.archive_download_url || ""),
        }));
    },

    async downloadWorkflowArtifact(accessToken: string, input: { owner: string; repo: string; artifactId: number }): Promise<DownloadedArtifact> {
      const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/artifacts/${input.artifactId}/zip`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { ...apiHeaders(accessToken) },
          redirect: "manual",
        });
      } catch {
        throw new GithubServiceError("workflow_artifact_download_transport_failed");
      }
      let finalResponse = response;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || !/^https:\/\//.test(location)) {
          throw new GithubServiceError("workflow_artifact_redirect_invalid");
        }
        try {
          finalResponse = await fetchImpl(location);
        } catch {
          throw new GithubServiceError("workflow_artifact_download_transport_failed");
        }
      }
      if (!finalResponse.ok) throw new GithubServiceError("workflow_artifact_download_failed", finalResponse.status);
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await finalResponse.arrayBuffer());
      } catch {
        throw new GithubServiceError("workflow_artifact_download_invalid");
      }
      const suggestedFilename = String(finalResponse.headers.get("content-disposition") || `artifact-${input.artifactId}.zip`)
        .replace(/^attachment;?\s*/i, "")
        .replace(/filename\*?=(UTF-8'')?/i, "")
        .replace(/["\\]/g, "")
        .trim() || `artifact-${input.artifactId}.zip`;
      return { bytes, suggestedFilename };
    },
  };
}
