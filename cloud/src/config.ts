import { Buffer } from "node:buffer";

export interface CloudConfig {
  port: number;
  host: string;
  baseUrl: string;
  openCodeBaseUrl: string;
  openCodeApiKey: string;
  openRouterApiKey: string;
  github: GithubConfig;
  rateLimitEnabled: boolean;
  trustProxy: boolean;
}

export interface GithubConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appCallbackUrl: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  tokenEncryptionKey: Buffer | null;
}

const DEFAULTS = {
  port: 8080,
  host: "0.0.0.0",
  baseUrl: "http://localhost:8080",
  openCodeBaseUrl: "http://127.0.0.1:49374",
  openCodeApiKey: "",
  openRouterApiKey: "",
  githubApiBaseUrl: "https://api.github.com",
  githubAuthBaseUrl: "https://github.com",
  githubAppCallbackUrl: "cloudopencode://github/callback",
};

function loadTokenEncryptionKey(): Buffer | null {
  const encoded = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export function loadConfig(): CloudConfig {
  const port = Number(process.env.PORT || DEFAULTS.port);
  const host = process.env.HOST || DEFAULTS.host;
  const baseUrl = process.env.CLOUD_BASE_URL || DEFAULTS.baseUrl;
  const openCodeBaseUrl = process.env.OPENCODE_BASE_URL || DEFAULTS.openCodeBaseUrl;
  const openCodeApiKey = process.env.OPENCODE_API_KEY || DEFAULTS.openCodeApiKey;
  const openRouterApiKey = process.env.OPENROUTER_API_KEY || DEFAULTS.openRouterApiKey;
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI || "";
  if (redirectUri && !/^https:\/\//.test(redirectUri)) {
    throw new Error("GITHUB_OAUTH_REDIRECT_URI must use https");
  }
  const github: GithubConfig = {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    redirectUri,
    appCallbackUrl: process.env.GITHUB_APP_CALLBACK_URL || DEFAULTS.githubAppCallbackUrl,
    apiBaseUrl: process.env.GITHUB_API_BASE_URL || DEFAULTS.githubApiBaseUrl,
    authBaseUrl: process.env.GITHUB_AUTH_BASE_URL || DEFAULTS.githubAuthBaseUrl,
    tokenEncryptionKey: loadTokenEncryptionKey(),
  };
  if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error("Invalid PORT");
  if (!/^https?:\/\//.test(baseUrl)) throw new Error("CLOUD_BASE_URL must be an absolute http(s) URL");
  if (!/^https?:\/\//.test(openCodeBaseUrl)) throw new Error("OPENCODE_BASE_URL must be an absolute http(s) URL");
  if (!/^https:\/\//.test(github.apiBaseUrl)) throw new Error("GITHUB_API_BASE_URL must use https");
  if (!/^https:\/\//.test(github.authBaseUrl)) throw new Error("GITHUB_AUTH_BASE_URL must use https");
  if (!/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(github.appCallbackUrl)) {
    throw new Error("GITHUB_APP_CALLBACK_URL must be an absolute URL");
  }
  return {
    port,
    host,
    baseUrl,
    openCodeBaseUrl,
    openCodeApiKey,
    openRouterApiKey,
    github,
    rateLimitEnabled: (process.env.RATE_LIMIT_ENABLED ?? "1") !== "0",
    trustProxy: (process.env.TRUST_PROXY ?? "0") === "1",
  };
}
