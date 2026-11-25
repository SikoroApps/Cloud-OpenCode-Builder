import { execFileSync } from "node:child_process";
import { evaluateReleaseReadiness } from "../src/release-readiness.ts";

/**
 * Prints only names, booleans, HTTP status and blocker codes.
 * Secret values, tokens, keys and full URLs are never printed.
 */
const args = process.argv.slice(2);
const requireLive = args.includes("--require-live") || process.env.REQUIRE_LIVE === "1";
const repoIndex = args.indexOf("--repo");
const repo = (repoIndex >= 0 ? args[repoIndex + 1] : process.env.APP_REPO) || "";

let signingSecretNames = [];
let secretListBlocker = null;
if (/^[^/\s]+\/[^/\s]+$/.test(repo)) {
  try {
    const listing = execFileSync("gh", ["secret", "list", "--repo", repo], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    signingSecretNames = listing
      .split("\n")
      .map((line) => line.split("\t")[0]?.trim())
      .filter(Boolean);
  } catch {
    secretListBlocker = "gh_secret_list_failed_for_target_repository";
  }
} else {
  secretListBlocker = "target_repository_is_not_set_or_invalid";
}

const backendBaseUrl = process.env.CLOUD_BASE_URL || "";
let backendHealthStatus = null;
if (backendBaseUrl) {
  try {
    const healthUrl = new URL("/health", backendBaseUrl);
    if (healthUrl.protocol === "https:") {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(8_000) });
      backendHealthStatus = response.status;
    }
  } catch {
    backendHealthStatus = null;
  }
}

const providerKeyNames = ["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]
  .filter((name) => Boolean(process.env[name]));

const result = evaluateReleaseReadiness({
  signingSecretNames,
  backendBaseUrl,
  backendHealthStatus,
  providerKeyNames,
});
if (secretListBlocker && !result.blockers.includes(secretListBlocker)) {
  result.blockers.unshift(secretListBlocker);
  result.readyForRelease = false;
}

console.log(JSON.stringify({
  status: result.readyForRelease ? "VERIFIED" : "BLOCKED",
  checks: result.checks,
  blockers: result.blockers,
  providerKeyNames,
}, null, 2));
if (requireLive && !result.readyForRelease) process.exitCode = 1;
