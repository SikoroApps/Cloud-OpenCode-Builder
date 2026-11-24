export interface CloudConfig {
  port: number;
  host: string;
  baseUrl: string;
  openCodeBaseUrl: string;
  openCodeApiKey: string;
  openRouterApiKey: string;
}

const DEFAULTS = {
  port: 8080,
  host: "0.0.0.0",
  baseUrl: "http://localhost:8080",
  openCodeBaseUrl: "http://127.0.0.1:49374",
  openCodeApiKey: "",
  openRouterApiKey: "",
};

export function loadConfig(): CloudConfig {
  const port = Number(process.env.PORT || DEFAULTS.port);
  const host = process.env.HOST || DEFAULTS.host;
  const baseUrl = process.env.CLOUD_BASE_URL || DEFAULTS.baseUrl;
  const openCodeBaseUrl = process.env.OPENCODE_BASE_URL || DEFAULTS.openCodeBaseUrl;
  const openCodeApiKey = process.env.OPENCODE_API_KEY || DEFAULTS.openCodeApiKey;
  const openRouterApiKey = process.env.OPENROUTER_API_KEY || DEFAULTS.openRouterApiKey;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error("Invalid PORT");
  if (!/^https?:\/\//.test(baseUrl)) throw new Error("CLOUD_BASE_URL must be an absolute http(s) URL");
  if (!/^https?:\/\//.test(openCodeBaseUrl)) throw new Error("OPENCODE_BASE_URL must be an absolute http(s) URL");
  return { port, host, baseUrl, openCodeBaseUrl, openCodeApiKey, openRouterApiKey };
}
