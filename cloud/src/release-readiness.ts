import { REQUIRED_ACTIONS_SECRET_NAMES } from "./readiness.ts";

export interface ReleaseReadinessInput {
  signingSecretNames: string[];
  backendBaseUrl: string;
  backendHealthStatus: number | null;
  providerKeyNames: string[];
}

export interface ReleaseReadinessResult {
  checks: {
    signingSecretsPresent: boolean;
    backendUrlHttps: boolean;
    backendHealthOk: boolean;
    providerKeyConfigured: boolean;
  };
  blockers: string[];
  readyForRelease: boolean;
}

/** Evaluates release prerequisites from names, URLs' scheme and HTTP status only. */
export function evaluateReleaseReadiness(input: ReleaseReadinessInput): ReleaseReadinessResult {
  const present = new Set(input.signingSecretNames.map((name) => String(name).trim()).filter(Boolean));
  const missingSigningSecrets = REQUIRED_ACTIONS_SECRET_NAMES.filter((name) => !present.has(name));
  const checks = {
    signingSecretsPresent: missingSigningSecrets.length === 0,
    backendUrlHttps: isHttpsUrl(input.backendBaseUrl),
    backendHealthOk: input.backendHealthStatus === 200,
    providerKeyConfigured: input.providerKeyNames.length > 0,
  };
  const blockers: string[] = [];
  for (const name of missingSigningSecrets) {
    blockers.push(`signing secret ${name} is not present`);
  }
  if (!checks.backendUrlHttps) blockers.push("CLOUD_BASE_URL must be an HTTPS URL");
  if (checks.backendUrlHttps && !checks.backendHealthOk) {
    blockers.push("backend HTTPS health check did not return 200");
  }
  if (!checks.providerKeyConfigured) {
    blockers.push("no AI provider key is configured for live release verification");
  }
  return {
    checks,
    blockers,
    readyForRelease: blockers.length === 0,
  };
}

function isHttpsUrl(value: string): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
