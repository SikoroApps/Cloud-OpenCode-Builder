import type { GithubConfig } from "./config.ts";
import { GITHUB_OAUTH_SCOPES, isGithubConfigured } from "./github.ts";

export const REQUIRED_ACTIONS_SECRET_NAMES = [
  "ANDROID_KEYSTORE_BASE64",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD",
] as const;

export interface ReadinessCloudContext {
  baseUrl: string;
  openRouterApiKeySet: boolean;
  openCodeApiKeySet: boolean;
}

export interface ConfigReadiness {
  githubOAuth: {
    configured: boolean;
    clientIdSet: boolean;
    clientSecretSet: boolean;
    redirectUriHttps: boolean;
    redirectUriMatchesBaseUrl: boolean;
    encryptionKeyValid: boolean;
    appCallbackSet: boolean;
    appCallbackSchemeValid: boolean;
    scopes: string;
  };
  cloudBackend: {
    baseUrlSet: boolean;
    baseUrlHttps: boolean;
    openRouterKeySet: boolean;
    openCodeKeySet: boolean;
  };
  requiredActionsSecrets: string[];
  manualChecks: string[];
  blockers: string[];
  readyForLiveOAuth: boolean;
  readyForLiveAiEditing: boolean;
  readyForLiveBuilds: boolean;
}

/**
 * Builds a configuration summary from presence/format checks only.
 * No secret, token, key or callback value is ever copied into the result.
 */
export function getConfigReadiness(github: GithubConfig, cloud: ReadinessCloudContext): ConfigReadiness {
  const clientIdSet = Boolean(github.clientId);
  const clientSecretSet = Boolean(github.clientSecret);
  const redirectUriHttps = /^https:\/\//.test(github.redirectUri);
  const encryptionKeyValid = github.tokenEncryptionKey?.length === 32;
  const appCallbackSet = Boolean(github.appCallbackUrl);
  const baseUrlSet = Boolean(cloud.baseUrl);
  const baseUrlHttps = /^https:\/\//.test(cloud.baseUrl);
  const configured = isGithubConfigured(github);

  const hostname = (value: string): string => {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return "";
    }
  };
  const baseHost = hostname(cloud.baseUrl);
  const redirectHost = hostname(github.redirectUri);
  const redirectUriMatchesBaseUrl = Boolean(baseHost && redirectHost && baseHost === redirectHost);
  let appCallbackSchemeValid = false;
  try {
    appCallbackSchemeValid = new URL(github.appCallbackUrl).protocol === "cloudopencode:";
  } catch {
    appCallbackSchemeValid = false;
  }

  const blockers: string[] = [];
  if (!clientIdSet) blockers.push("GITHUB_CLIENT_ID is not set");
  if (!clientSecretSet) blockers.push("GITHUB_CLIENT_SECRET is not set");
  if (!redirectUriHttps) blockers.push("GITHUB_OAUTH_REDIRECT_URI must be an HTTPS URL");
  if (redirectUriHttps && baseUrlHttps && !redirectUriMatchesBaseUrl) {
    blockers.push("GITHUB_OAUTH_REDIRECT_URI host must match CLOUD_BASE_URL host");
  }
  if (!encryptionKeyValid) blockers.push("GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  if (!appCallbackSchemeValid) blockers.push("GITHUB_APP_CALLBACK_URL must use the cloudopencode scheme");
  if (!baseUrlHttps) blockers.push("CLOUD_BASE_URL must be an HTTPS URL");

  const readyForLiveAiEditing = cloud.openRouterApiKeySet || cloud.openCodeApiKeySet;
  if (!readyForLiveAiEditing) blockers.push("no AI provider key is configured for live AI file planning");

  return {
    githubOAuth: {
      configured,
      clientIdSet,
      clientSecretSet,
      redirectUriHttps,
      redirectUriMatchesBaseUrl,
      encryptionKeyValid,
      appCallbackSet,
      appCallbackSchemeValid,
      scopes: GITHUB_OAUTH_SCOPES,
    },
    cloudBackend: {
      baseUrlSet,
      baseUrlHttps,
      openRouterKeySet: cloud.openRouterApiKeySet,
      openCodeKeySet: cloud.openCodeApiKeySet,
    },
    requiredActionsSecrets: [...REQUIRED_ACTIONS_SECRET_NAMES],
    manualChecks: [
      "Create a GitHub OAuth App and set its callback URL to the configured HTTPS redirect URI.",
      "Authorize the app in a browser; a CLI token is not a substitute for user consent.",
      "Add all required signing secrets as protected GitHub Actions secrets in the selected app repository.",
      "Confirm a real Android device is connected before claiming device installation or launch.",
    ],
    blockers,
    readyForLiveOAuth: configured && baseUrlHttps && redirectUriMatchesBaseUrl && appCallbackSchemeValid,
    readyForLiveAiEditing,
    readyForLiveBuilds: configured && baseUrlHttps && redirectUriMatchesBaseUrl && appCallbackSchemeValid,
  };
}
