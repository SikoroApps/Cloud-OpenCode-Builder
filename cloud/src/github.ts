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

export interface GithubService {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<GithubTokenExchange>;
  fetchIdentity(accessToken: string): Promise<GithubIdentity>;
  revokeToken(accessToken: string): Promise<boolean>;
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
  };
}
