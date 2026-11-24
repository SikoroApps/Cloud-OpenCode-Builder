#!/usr/bin/env node
/**
 * Checks that the protected Android signing secret NAMES exist on a target repository.
 * It never reads or prints secret values: `gh secret list` can only list names and timestamps.
 *
 * Usage: node scripts/check-signing-secrets.mjs <owner/repo>
 * Exit codes: 0 ready, 1 missing secrets, 2 usage/gh failure.
 */
import { execFileSync } from "node:child_process";

const required = [
  "ANDROID_KEYSTORE_BASE64",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD",
];
const repo = process.argv[2] || process.env.GITHUB_REPOSITORY || "";

if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
  console.error("usage: node scripts/check-signing-secrets.mjs <owner/repo>");
  process.exit(2);
}

let listing;
try {
  listing = execFileSync("gh", ["secret", "list", "--repo", repo], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
} catch {
  console.log(JSON.stringify({ status: "blocked", reason: "gh_secret_list_failed", repo }, null, 2));
  process.exit(2);
}

const present = new Set(
  listing
    .split("\n")
    .map((line) => line.split("\t")[0]?.trim())
    .filter(Boolean),
);
const missing = required.filter((name) => !present.has(name));
console.log(
  JSON.stringify(
    {
      repo,
      required: required.length,
      present: required.filter((name) => present.has(name)),
      missing,
      readyForSigning: missing.length === 0,
    },
    null,
    2,
  ),
);
process.exit(missing.length === 0 ? 0 : 1);
