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

## Remaining blockers

- Free usage limit reached on the local OpenCode provider; cannot currently obtain further live responses without reset/credits.
- OpenRouter API key not configured, so OpenRouter-backed fallback models remain unverified live.
- Cloud backend deployment and HTTPS domain not configured.
- No Supabase project created for this backend yet; do not reuse Messenger Pro credentials.
