import type { ConfigReadiness } from "./readiness.ts";

export interface DeploymentPreflightInput {
  databaseDirectoryWritable: boolean;
  healthUrlConfigured: boolean;
  healthUrlIsHttps: boolean;
  healthStatus: number | null;
}

export interface DeploymentPreflightResult {
  checks: {
    databaseDirectoryWritable: boolean;
    httpsBaseUrl: boolean;
    githubOAuthReady: boolean;
    liveAiReady: boolean;
    healthCheckHttps: boolean;
    healthCheckOk: boolean;
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
    liveAiReady: readiness.readyForLiveAiEditing,
    healthCheckHttps: input.healthUrlConfigured && input.healthUrlIsHttps,
    healthCheckOk: input.healthStatus === 200,
  };
  const blockers: string[] = [];
  if (!checks.databaseDirectoryWritable) blockers.push("database directory is not writable");
  if (!checks.httpsBaseUrl) blockers.push("CLOUD_BASE_URL must be an HTTPS URL");
  if (!checks.githubOAuthReady) blockers.push("GitHub OAuth configuration is not ready");
  if (!checks.liveAiReady) blockers.push("no AI provider key is configured for live AI file planning");
  if (!input.healthUrlConfigured) blockers.push("DEPLOYMENT_HEALTH_URL is not configured");
  else if (!input.healthUrlIsHttps) blockers.push("DEPLOYMENT_HEALTH_URL must use https");
  if (input.healthUrlConfigured && !checks.healthCheckOk) blockers.push("deployment health check did not return 200");

  return {
    checks,
    blockers,
    readyForDeployment: blockers.length === 0,
  };
}
