import { loadConfig } from "../src/config.ts";
import { getConfigReadiness } from "../src/readiness.ts";

const config = loadConfig();
const readiness = getConfigReadiness(config.github, {
  baseUrl: config.baseUrl,
  openRouterApiKeySet: Boolean(config.openRouterApiKey),
  openCodeApiKeySet: Boolean(config.openCodeApiKey),
});

// Intentionally prints presence booleans and blocker codes only. Never print values.
console.log(JSON.stringify(readiness, null, 2));
