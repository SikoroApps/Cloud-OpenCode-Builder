import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const compose = read("deploy/docker-compose.yml");
const caddyfile = read("deploy/Caddyfile");
const envExample = read("deploy/.env.example");

const checks = {
  backendBoundToLoopback: compose.includes('127.0.0.1:8080:8080'),
  persistentDatabaseVolume: compose.includes("backend-data:/data"),
  caddyWaitsForHealthyBackend: compose.includes("condition: service_healthy"),
  caddyUsesConfiguredDomain: caddyfile.includes("{$CLOUD_DOMAIN}"),
  caddyReverseProxiesBackend: caddyfile.includes("reverse_proxy backend:8080"),
  caddySetsHsts: caddyfile.includes("Strict-Transport-Security"),
  caddySetsNosniff: caddyfile.includes("X-Content-Type-Options"),
  envExampleDocumentsHttpsBaseUrl: envExample.includes("CLOUD_BASE_URL=https://"),
  envExampleDocumentsHealthUrl: envExample.includes("DEPLOYMENT_HEALTH_URL=https://"),
  envExampleDocumentsBothProviders: envExample.includes("OPENCODE_API_KEY=") && envExample.includes("OPENROUTER_API_KEY="),
};

// Never print file contents; these are structural checks only.
console.log(JSON.stringify({ checks, passed: Object.values(checks).every(Boolean) }, null, 2));
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
