# Phase 2 — Cloud AI Engine

Status: **IMPLEMENTATION AND VERIFICATION COMPLETE** on implementation commit `9ccee3d`. Production hosting,
a permanent TLS domain and backend provider secrets remain external follow-on work.

## Implemented

- Deployable Node.js cloud backend under `cloud/`:
  - `GET /health`, `GET /api/models`, auth, chat and chat-history endpoints.
  - User registration/login with scrypt password hashing and hashed bearer sessions.
  - SQLite-backed chat persistence with per-user/session isolation.
  - AI fallback orchestration using the exact required five-model free chain.
  - OpenCode and OpenRouter provider adapters; all credentials read from environment variables.
  - Dockerfile, `.dockerignore`, deployment README and a container-build CI step.
  - 8 automated backend tests, including an API integration test that restarts the server and
    verifies auth plus chat-history persistence (AI stubbed; clearly not a live-provider test).
- Android cloud client:
  - HTTPS-only base URL validation with an optional host allowlist.
  - Register/login/logout/chat/history/health API methods.
  - Encrypted token storage using Android Keystore AES-GCM.
  - Unit tests for URL security and an instrumented HTTPS integration test against a temporary
    HTTPS tunnel to the local backend.
  - Build-time public endpoint configuration via `CLOUD_BASE_URL` / `CLOUD_HOST_ALLOWLIST`
    environment variables; no secret is embedded in the app.

## Final CI evidence

- `Cloud Backend CI` run `45347166634` on implementation commit `9ccee3d`: **success**
  (8 backend tests, health smoke, container image build).
- `Android CI` run `45347166635` on implementation commit `9ccee3d`: **success** (all three jobs):
  - `verify`: unit tests, backend core tests, Android lint, debug APK assembly, package-name check
    and secret-marker scan.
  - `Emulator app-launch smoke test`: API 35 launch smoke passed.
  - `Android HTTPS backend integration`: a Cloudflare quick HTTPS tunnel exposed the local backend;
    the emulator test `clientCommunicatesWithBackendOverHttps` passed with **1 test, 0 failures,
    0 skipped**. It exercised health, register, chat, history and logout entirely over `https://`.

Earlier CI failures were fixed before the final run:

- `45340096492`: initial Phase 2 Android compile errors (fixed).
- `45344526434`: remaining OkHttp/Keystore/data-class compile errors (fixed).
- `45345888322`: HTTPS job used unsupported `--tests` on `connectedDebugAndroidTest` (fixed with
  `-Pandroid.testInstrumentationRunnerArguments.class=...`).
- `45346466679`: HTTPS test failed on bodyless POST logout (fixed by sending an empty JSON body).

Successful intermediate runs: `45345330348` (Android) and `45345330402` (Cloud Backend) on
`ba749e8`, plus `45345888090` (Cloud Backend) on `d5bb65d`.

## Verified locally and in CI

- `cd cloud && npm test`: **8 passed, 0 failures** (fallback order/eligibility/switching/exhaustion,
  password hashing, session persistence, and API persistence across restart).
- Backend smoke test: `GET /health` -> `200 {"status":"ok"}`; register -> `201`; login -> `200`;
  `GET /api/auth/me` -> `200`; `GET /api/chat/history` -> `200 {"history":[]}`; `POST /api/chat`
  persisted the user turn and reported `ai_fallback_exhausted` when real providers were unavailable.
- Container builds successfully in CI (`docker build -t cloud-opencode-backend:ci .`).
- Android HTTPS integration passed in a real API 35 emulator against an HTTPS URL.

## Real provider evidence

These are direct provider probes, not simulated tests and not all of them were made through the
backend adapter:

- `opencode/big-pickle`: real assistant text `MODELTEST`.
- `opencode/deepseek-v4.1-flash-free`: real assistant text `MODELTEST`.
- `opencode/flint-40b-free`: real assistant text `MODELTEST`.
- OpenCode stateless generate route: real `ProviderRequestError` with `reason: rate_limit`,
  `status: 429` and `Free usage limit reached...`.
- Direct OpenRouter probes for both required free models returned real upstream `429`
  temporary-rate-limit responses. No live successful OpenRouter response was observed.

`opencode models` listing the five required models is only listing evidence, not availability
evidence. The stubbed API persistence test and controlled fallback tests are explicitly simulated
integration coverage, not live verification of every provider.

## Gemma 4 26B A4B free root cause (2026-11-25)

The recurring `Error: Provider returned error` was traced to the last entry in the free chain:

- Configured model: `openrouter/google/gemma-4-26b-a4b-it:free`.
- Backend split: provider `openrouter`, model ID `google/gemma-4-26b-a4b-it:free`.
- Actual OpenCode session error: `type: provider.rate-limit`, `status: 429`, `message:
  Provider returned error`. The response body reported provider `Google AI Studio`,
  `provider_error_code: 429`, and `limit_source: upstream_provider_shared_pool`.
- The same upstream `429` was reproduced twice through the OpenRouter chat-completions API with a
  single request each and no retry loop:
  - plain text request (`"Reply with exactly: OK"`, `max_tokens: 16`): HTTP `429`, elapsed 2089 ms;
  - tool-calling request (one `echo` function tool): HTTP `429`, elapsed 661 ms.
- Both responses contained the same remedy hint: retry shortly, add a provider key to use private
  limits, or route to another provider. The user identifier in the response is redacted here.

Representative redacted response body:

```json
{
  "error": {
    "message": "Provider returned error",
    "code": 429,
    "metadata": {
      "raw": "google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream. Please retry shortly, or add your own provider key to use your own limits: https://openrouter.ai/workspaces/default/byok",
      "provider_name": "Google AI Studio",
      "is_byok": false,
      "provider_error_code": "429",
      "limit_source": "upstream_provider_shared_pool",
      "remedy_hint": "Retry shortly, add your own provider key to use your own limits (https://openrouter.ai/workspaces/default/byok), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing."
    }
  },
  "user_id": "<REDACTED>"
}
```

This rules out authentication, model routing, unsupported parameters, context limits and
tool-calling incompatibility as the cause: the request reached the provider and was rejected by the
upstream shared free pool before any text or tool result was produced. The global fallback plugin
had already exhausted its five configured attempts, so OpenCode's own retry loop kept retrying the
last model. `cloud/src/ai.ts` now caps each model at one retry, opens a 60-second circuit breaker
after two failures, wraps to the next healthy free model (including after Gemma fails), and records
failed models only as failed attempts. Gemma is therefore marked unsuitable for automatic
agent/tool-calling work until upstream availability or a private key is available. The verified
free replacement for automatic building is `opencode/big-pickle`, with
`opencode/deepseek-v4.1-flash-free` and `opencode/flint-40b-free` as verified free alternates.

## Completion criteria

- Cloud service runnable: **yes** locally and as a container image.
- At least one real AI provider response: **yes** (three OpenCode models returned `MODELTEST`).
- Five-model fallback logic tested: **yes**, controlled tests assert exact order, one-retry cap,
  circuit-breaker exclusion, Gemma-to-healthy-model wrap, recovery after cooldown and exhaustion.
- Automatic switching demonstrated: **yes**, controlled integration tests plus a real `429`
  provider error; a full live five-model success chain was not possible because OpenRouter free
  models were rate-limited and no backend `OPENROUTER_API_KEY` secret is configured.
- Chat history persists: **yes**, SQLite-backed and verified through the API across a server
  restart with stubbed AI.
- Android communicates with backend over HTTPS: **yes**, verified in an API 35 emulator against an
  HTTPS tunnel, with 1 passed test and 0 skipped.
- CI green on the implementation commit: **yes** (`45347166635` and `45347166634` on `9ccee3d`).
- Docs with evidence and blockers: **yes** (this file, `docs/PROGRESS.md` and `README.md`).

## Remaining external blockers / follow-on work

- No permanent hosting account, domain or TLS certificate was provided. The HTTPS evidence uses an
  accountless temporary tunnel, not a production deployment.
- `OPENROUTER_API_KEY` is not configured as a backend deployment secret; direct OpenRouter free-model
  probes were rate-limited upstream.
- OpenCode free quotas can be exhausted and should not be assumed available without a fresh probe.
- No separate Supabase project/credentials exist; the Messenger Pro project must not be reused.
