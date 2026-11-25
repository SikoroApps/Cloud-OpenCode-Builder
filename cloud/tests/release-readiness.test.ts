import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateReleaseReadiness } from "../src/release-readiness.ts";
import { REQUIRED_ACTIONS_SECRET_NAMES } from "../src/readiness.ts";

const signingSecretNames = [...REQUIRED_ACTIONS_SECRET_NAMES];

function input(overrides: Partial<Parameters<typeof evaluateReleaseReadiness>[0]> = {}) {
  return {
    signingSecretNames,
    backendBaseUrl: "https://builder.example.invalid",
    backendHealthStatus: 200,
    providerKeyNames: ["OPENROUTER_API_KEY"],
    ...overrides,
  };
}

test("release readiness is positive only with all masked prerequisites", () => {
  const result = evaluateReleaseReadiness(input());
  assert.equal(result.readyForRelease, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.checks.signingSecretsPresent, true);
  assert.equal(result.checks.backendUrlHttps, true);
  assert.equal(result.checks.backendHealthOk, true);
  assert.equal(result.checks.providerKeyConfigured, true);
});

test("release readiness reports missing signing secret names only", () => {
  const result = evaluateReleaseReadiness(input({
    signingSecretNames: signingSecretNames.slice(0, 3),
  }));
  assert.equal(result.readyForRelease, false);
  assert.deepEqual(result.blockers, ["signing secret ANDROID_KEY_PASSWORD is not present"]);
});

test("release readiness rejects a non-HTTPS backend and a failed health check", () => {
  const insecure = evaluateReleaseReadiness(input({ backendBaseUrl: "http://builder.example.invalid" }));
  assert.deepEqual(insecure.blockers, ["CLOUD_BASE_URL must be an HTTPS URL"]);
  const unhealthy = evaluateReleaseReadiness(input({ backendHealthStatus: 503 }));
  assert.deepEqual(unhealthy.blockers, ["backend HTTPS health check did not return 200"]);
});

test("release readiness requires at least one provider key name", () => {
  const result = evaluateReleaseReadiness(input({ providerKeyNames: [] }));
  assert.deepEqual(result.blockers, ["no AI provider key is configured for live release verification"]);
});

test("release readiness output never copies credential values", () => {
  const result = evaluateReleaseReadiness(input({
    providerKeyNames: ["OPENROUTER_API_KEY_MARKER"],
    backendBaseUrl: "https://secret-host.example.invalid",
  }));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret-host"), false);
  assert.equal(serialized.includes("MARKER"), false);
});
