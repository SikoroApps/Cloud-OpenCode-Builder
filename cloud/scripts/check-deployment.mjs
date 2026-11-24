import { accessSync, constants } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../src/config.ts";
import { evaluateDeploymentReadiness } from "../src/deployment.ts";
import { getConfigReadiness } from "../src/readiness.ts";

const strict = process.argv.includes("--require-live");
const config = loadConfig();
const readiness = getConfigReadiness(config.github, {
  baseUrl: config.baseUrl,
  openRouterApiKeySet: Boolean(config.openRouterApiKey),
  openCodeApiKeySet: Boolean(config.openCodeApiKey),
});

const dbPath = process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite";
let databaseDirectoryWritable = false;
try {
  accessSync(dirname(dbPath) || ".", constants.W_OK);
  databaseDirectoryWritable = true;
} catch {
  databaseDirectoryWritable = false;
}

const healthUrl = process.env.DEPLOYMENT_HEALTH_URL || "";
let healthUrlIsHttps = false;
let healthStatus = null;
if (healthUrl) {
  try {
    healthUrlIsHttps = new URL(healthUrl).protocol === "https:";
  } catch {
    healthUrlIsHttps = false;
  }
  try {
    const response = await fetch(healthUrl);
    healthStatus = response.status;
  } catch {
    healthStatus = null;
  }
}

const result = evaluateDeploymentReadiness(readiness, {
  databaseDirectoryWritable,
  healthUrlConfigured: Boolean(healthUrl),
  healthUrlIsHttps,
  healthStatus,
});

// Prints checks and blocker codes only. Never prints environment values or secrets.
console.log(JSON.stringify({ readiness, deployment: result }, null, 2));
if (strict && !result.readyForDeployment) process.exitCode = 1;
