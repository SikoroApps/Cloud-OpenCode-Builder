# Phase 2 — Cloud AI Engine

Status: **IN PROGRESS** — foundation implemented and locally verified; cloud deployment, real OpenRouter credentials and final CI evidence pending.

## Implemented

- Deployable Node.js cloud backend under `cloud/`:
  - HTTP server with health, auth, chat and model endpoints.
  - User registration/login with scrypt password hashing and hashed bearer sessions.
  - Persistent SQLite-backed chat history per user/session.
  - AI fallback orchestration with the required five-model free chain.
  - OpenCode provider adapter using the OpenCode generate route.
  - OpenRouter provider adapter for the two OpenRouter free models.
- Android backend client under `android/app/src/main/java/com/sikorokoro44/cloudopencode/data/network/`:
  - HTTPS enforcement with optional host allowlist.
  - Register/login/chat/history/logout API client shape.
  - Encrypted token storage under `security/` (Android Keystore AES-GCM).
  - Secure URL unit tests.

## CI fix — Phase 2 first green attempt (run `45340096492`)

The first Android CI run triggered by the Phase 2 commit (`45340096492`) **failed**:

- `Cloud Backend CI` run `45340096468`: **success** (backend tests + health smoke green).
- `Android CI` run `45340096492`: **failure** — `verify` job "Run unit tests" failed and emulator
  smoke job failed during Android compilation of the new Phase 2 client code.

Failing compile errors (fixed in this batch):

- `CloudApiClient.kt:23:45 Unresolved reference 'BuildConfig'` — missing explicit import of the
  generated `BuildConfig` class from the parent package.
- `CloudApiClient.kt:37` — helper method resolution errors in HTTPS allowlist check.
- `CloudApiClient.kt:43-126` — nullable `JSONObject` handling, `CloudApiError` not extending
  `Throwable`, deprecated OkHttp `MediaType.parse`, OkHttp `Request.Builder` vs `Request` mismatch.
- `CloudApiModels.kt:38-39` — `message` in `CloudApiError` cannot be overridden (final).
- `EncryptedTokenStore.kt` — Android Keystore AES-GCM API usage errors.

Fixes applied:

- Added explicit `import com.sikorokoro44.cloudopencode.BuildConfig` to `CloudApiClient.kt`.
- Rewrote `CloudApiClientImpl` HTTP layer: `CloudApiError` now extends `Exception`, request layer
  returns non-null `JSONObject`, uses OkHttp 4 APIs (`MediaType.get`, `RequestBody.create`) and
  builds a proper `okhttp3.Request`.
- Rewrote `CloudApiError` as a `Throwable`-based sealed class.
- Rewrote `EncryptedTokenStore` Keystore AES-GCM implementation with valid API usage.

A follow-up CI run must be green before Phase 2 can be considered complete.

## Verified locally

- Cloud backend tests: 7 passed, 0 failures (`node --test tests/*.test.ts`).
- Backend server smoke test locally:
  - `GET /health` -> `200 {"status":"ok"}`
  - `POST /api/auth/register` -> `201`, login -> `200`, `GET /api/auth/me` -> `200`
  - `GET /api/chat/history` -> `200 {"history":[]}`
  - `POST /api/chat` -> persisted user turn and returned `ai_fallback_exhausted` after real provider errors.
- Real OpenCode provider verification:
  - Session prompt to `opencode/big-pickle` returned assistant text `MODELTEST` (real provider response).
  - Stateless generate route returned `ProviderRequestError` with `reason: rate_limit`, `status: 429`, message: `Free usage limit reached...` (real provider response).

## Phase 2 completion criteria status

- Backend can run as a cloud service: locally runnable and smoke-tested; deployment pending.
- At least one real AI provider responded successfully: yes (`opencode/big-pickle` -> `MODELTEST`).
- Five-model fallback logic tested: yes (unit tests).
- Automatic switching demonstrated with real provider responses or controlled integration tests: real `429` rate-limit response from OpenCode provider plus controlled fallback tests.
- Chat history persists: SQLite-backed implementation and tests; end-to-end through API not fully smoke-tested beyond empty history.
- Android can communicate with backend using HTTPS: client and secure URL tests implemented; live network call not yet performed.

## Latest CI evidence

- `Cloud Backend CI` run `45340096468` on Phase 2 commit: **success** (backend tests + health smoke).
- `Android CI` run `45340096492` on Phase 2 commit: **failure** (new Android client code did not compile; compile errors fixed in this batch and pushed as follow-up).

## Remaining blockers

- Free usage limit reached on the local OpenCode provider; cannot currently obtain further live responses without reset/credits.
- OpenRouter API key not configured, so OpenRouter-backed fallback models remain unverified live.
- Cloud backend deployment and HTTPS domain not configured.
- No Supabase project created for this backend yet; do not reuse Messenger Pro credentials.
