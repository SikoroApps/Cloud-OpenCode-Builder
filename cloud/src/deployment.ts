import type { ConfigReadiness } from "./readiness.ts";

export interface DeploymentPreflightInput {
  databaseDirectoryWritable: boolean;
  healthUrlConfigured: boolean;
  healthUrlIsHttps: boolean;
  healthStatus: number | null;
  rateLimitEnabled: boolean;
  trustProxy: boolean;
}

export interface DeploymentPreflightResult {
  checks: {
    databaseDirectoryWritable: boolean;
    httpsBaseUrl: boolean;
    githubOAuthReady: boolean;
    oauthRedirectMatchesBaseUrl: boolean;
    liveAiReady: boolean;
    healthCheckHttps: boolean;
    healthCheckOk: boolean;
    rateLimitingEnabled: boolean;
    proxyTrustConfigured: boolean;
  };
  blockers: string[];
  readyForDeployment: boolean;
}

/**
 * Evaluates deployment readiness using booleans and status codes only.
 * No credential, token, key or URL value is copied into the result.
 */
export function evaluateDeploymentReadiness(
  readiness: ConfigReadiness,
  input: DeploymentPreflightInput,
): DeploymentPreflightResult {
  const checks = {
    databaseDirectoryWritable: input.databaseDirectoryWritable,
    httpsBaseUrl: readiness.cloudBackend.baseUrlHttps,
    githubOAuthReady: readiness.readyForLiveOAuth,
    oauthRedirectMatchesBaseUrl: readiness.githubOAuth.redirectUriMatchesBaseUrl,
    liveAiReady: readiness.readyForLiveAiEditing,
    healthCheckHttps: input.healthUrlConfigured && input.healthUrlIsHttps,
    healthCheckOk: input.healthStatus === 200,
    rateLimitingEnabled: input.rateLimitEnabled,
    proxyTrustConfigured: input.trustProxy,
  };
  const blockers: string[] = [];
  if (!checks.databaseDirectoryWritable) blockers.push("database directory is not writable");
  if (!checks.httpsBaseUrl) blockers.push("CLOUD_BASE_URL must be an HTTPS URL");
  if (!checks.githubOAuthReady) blockers.push("GitHub OAuth configuration is not ready");
  if (!checks.oauthRedirectMatchesBaseUrl) {
    blockers.push("GITHUB_OAUTH_REDIRECT_URI host must match CLOUD_BASE_URL host");
  }
  if (!checks.liveAiReady) blockers.push("no AI provider key is configured for live AI file planning");
  if (!input.healthUrlConfigured) blockers.push("DEPLOYMENT_HEALTH_URL is not configured");
  else if (!input.healthUrlIsHttps) blockers.push("DEPLOYMENT_HEALTH_URL must use https");
  if (input.healthUrlConfigured && !checks.healthCheckOk) blockers.push("deployment health check did not return 200");
  if (!checks.rateLimitingEnabled) blockers.push("rate limiting must be enabled in production");
  if (!checks.proxyTrustConfigured) blockers.push("TRUST_PROXY must be 1 behind the HTTPS reverse proxy");

  return {
    checks,
    blockers,
    readyForDeployment: blockers.length === 0,
  };
}
