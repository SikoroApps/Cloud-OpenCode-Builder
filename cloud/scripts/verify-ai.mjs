import { FALLBACK_CHAIN, runAiFallback } from "../src/ai.ts";
import { loadConfig } from "../src/config.ts";

/**
 * Live AI verification for Phase 9.
 *
 * With provider keys configured in the environment, this sends a real request through the
 * unchanged five-model fallback chain and reports only the winning model and attempt outcomes.
 * Without keys, it reports BLOCKED and never invents a successful provider call.
 *
 * No prompt content, response content, key, token or Authorization header is printed.
 */
const requireLive = process.argv.includes("--require-live") || process.env.REQUIRE_LIVE === "1";
delete process.env.CLOUD_AI_STUB;

const config = loadConfig();
const chain = FALLBACK_CHAIN.map((candidate) => candidate.id);
const blockers = [];
if (!config.openCodeApiKey && !config.openRouterApiKey) {
  blockers.push("no AI provider key is configured");
}

let report;
if (blockers.length) {
  report = { status: "BLOCKED", verified: false, blockers, chain };
} else {
  try {
    const result = await runAiFallback({
      messages: [{ role: "user", content: "Reply with exactly OK" }],
    });
    report = {
      status: "VERIFIED",
      verified: true,
      model: result.model,
      contentLength: result.content.length,
      finishReason: result.finishReason,
      attempts: result.attempts.map((attempt) => ({ model: attempt.model, finishReason: attempt.finishReason })),
      chain,
    };
  } catch {
    report = {
      status: "FAILED",
      verified: false,
      blockers: ["live provider fallback exhausted"],
      chain,
    };
  }
}

console.log(JSON.stringify(report, null, 2));
if (requireLive && !report.verified) process.exitCode = 1;
