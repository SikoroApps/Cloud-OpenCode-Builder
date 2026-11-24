# Phase 2 — Cloud AI Engine

Status: **IN PROGRESS** — backend, fallback engine, persistence, container build and Android HTTPS
client are implemented. Final CI evidence and permanent cloud deployment are being verified;
deployment credentials/domain are external dependencies.

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

## CI history

- `Cloud Backend CI` `45340096468` on `94470f6`: **success** (7 backend tests + health smoke).
- `Android CI` `45340096492` on `94470f6`: **failure** (new Phase 2 Android code did not compile).
- `Cloud Backend CI` `45344526350` on `48d98d8`: **success**.
- `Android CI` `45344526434` on `48d98d8`: **failure** (remaining OkHttp/Keystore/data-class errors).
- `Cloud Backend CI` `45345330402` on `ba749e8`: **success** (8 tests, health smoke, container build).
- `Android CI` `45345330348` on `ba749e8`: **success** (unit tests, backend core tests, lint,
  emulator smoke test, debug APK assembly and secret-marker scan).
- `Cloud Backend CI` `45345888090` on `d5bb65d`: **success**.
- `Android CI` `45345888322` on `d5bb65d`: final HTTPS-integration run in progress at the time of
  this document update.

The earlier compile failures were fixed by adding the generated `BuildConfig` import, using OkHttp 4
extension APIs, correcting the `CloudApiError` data classes, and rewriting Android Keystore AES-GCM
usage with valid `KeyGenParameterSpec`/`GCMParameterSpec` calls.

## Verified locally and in CI

- `cd cloud && npm test`: **8 passed, 0 failures** (fallback order/eligibility/switching/exhaustion,
  password hashing, session persistence, and API persistence across restart).
- Backend smoke test: `GET /health` -> `200 {"status":"ok"}`; register -> `201`; login -> `200`;
  `GET /api/auth/me` -> `200`; `GET /api/chat/history` -> `200 {"history":[]}`; `POST /api/chat`
  persisted the user turn and reported `ai_fallback_exhausted` when real providers were unavailable.
- Container builds successfully in GitHub Actions (`docker build -t cloud-opencode-backend:ci .`).
- Android unit tests, lint, API 35 emulator smoke test, debug APK assembly and secret-marker scan are
  green in `Android CI` `45345330348`.

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

## Completion criteria status

- Cloud service runnable: **yes** locally and as a container image; no permanent hosted deployment.
- At least one real AI provider response: **yes** (three OpenCode models returned `MODELTEST`).
- Five-model fallback logic tested: **yes**, controlled tests assert exact order and exhaustion.
- Automatic switching demonstrated: **yes**, controlled integration tests plus a real `429`
  provider error; a full live five-model success chain was not possible because OpenRouter free
  models were rate-limited and no backend `OPENROUTER_API_KEY` secret is configured.
- Chat history persists: **yes**, SQLite-backed and verified through the API across a server
  restart with stubbed AI.
- Android communicates with backend over HTTPS: client enforcement and integration test are
  implemented; final CI evidence pending in run `45345888322`. Permanent deployment still absent.

## Remaining blockers

- No hosting account, domain or TLS certificate was provided for a permanent cloud deployment.
- `OPENROUTER_API_KEY` is not configured as a backend deployment secret; direct OpenRouter free-model
  probes were rate-limited upstream.
- OpenCode free quotas can be exhausted and should not be assumed available without a fresh probe.
- No separate Supabase project/credentials exist for this backend; the Messenger Pro project must not
  be reused.
- Phase 2 is not complete until the final HTTPS integration CI run is green and any remaining
  criteria have evidence.
