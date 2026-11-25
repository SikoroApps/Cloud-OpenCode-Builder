import type { CloudConfig } from "./config.ts";

export const GITHUB_OAUTH_CALLBACK_PATH = "/api/github/oauth/callback";
const MOBILE_CALLBACK_PROTOCOL = "cloudopencode:";

/**
 * Returns a stable error code when configuration is unsafe, or null when it is acceptable.
 * Error codes deliberately contain variable names only: no URL, key, token or secret value.
 */
export function validateCloudConfig(
  config: CloudConfig,
  isProduction: boolean = process.env.NODE_ENV === "production",
): string | null {
  if (isProduction) {
    if (!config.baseUrl.startsWith("https://")) return "CLOUD_BASE_URL must use https in production";
    if (!config.rateLimitEnabled) return "RATE_LIMIT_ENABLED must be 1 in production";
    if (!config.trustProxy) return "TRUST_PROXY must be 1 behind the HTTPS reverse proxy";
  }

  let mobileCallback: URL;
  try {
    mobileCallback = new URL(config.github.appCallbackUrl);
  } catch {
    return "GITHUB_APP_CALLBACK_URL must be an absolute URL";
  }
  if (mobileCallback.protocol !== MOBILE_CALLBACK_PROTOCOL) {
    return "GITHUB_APP_CALLBACK_URL must use the cloudopencode scheme";
  }

  const github = config.github;
  const oauthConfigured = Boolean(
    github.clientId || github.clientSecret || github.redirectUri || github.tokenEncryptionKey,
  );
  if (!oauthConfigured && !isProduction) return null;

  if (!github.clientId) return "GITHUB_CLIENT_ID is not set";
  if (!github.clientSecret) return "GITHUB_CLIENT_SECRET is not set";
  if (!github.redirectUri) return "GITHUB_OAUTH_REDIRECT_URI is not set";
  if (github.tokenEncryptionKey?.length !== 32) {
    return "GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes";
  }

  let redirect: URL;
  try {
    redirect = new URL(github.redirectUri);
  } catch {
    return "GITHUB_OAUTH_REDIRECT_URI must be an absolute URL";
  }
  if (redirect.protocol !== "https:") return "GITHUB_OAUTH_REDIRECT_URI must use https";
  if (redirect.pathname !== GITHUB_OAUTH_CALLBACK_PATH) {
    return "GITHUB_OAUTH_REDIRECT_URI path must be /api/github/oauth/callback";
  }

  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    return "CLOUD_BASE_URL must be an absolute URL";
  }
  if (redirect.hostname.toLowerCase() !== base.hostname.toLowerCase()) {
    return "GITHUB_OAUTH_REDIRECT_URI host must match CLOUD_BASE_URL host";
  }
  return null;
}
