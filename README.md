# Cloud OpenCode

Cloud OpenCode is an AI-powered cloud app-building platform. Users chat with an AI agent to
create and modify Android applications, connect GitHub repositories, run cloud builds, and
download signed APKs. Cloud tasks continue running even when the user's phone disconnects.

## Product rules

- Build and release through GitHub Actions. No local Android SDK build is required.
- Secrets and signing material must never be committed to this public repository.
- AI model access uses free models only, with an automatic fallback chain.
- Android targets Android 8 (API 26) and later.

## AI model system

Free models only. Fallback chain (in priority order):

1. `opencode/big-pickle`
2. `opencode/deepseek-v4.1-flash-free`
3. `opencode/flint-40b-free`
4. `openrouter/baidu/ernie-5.5-flash-preview:free`
5. `openrouter/google/gemma-4-26b-a4b-it:free`

The agent switches to the next available model after eligible provider errors, rate limits or
exhausted quotas. It avoids infinite retries and verifies availability before claiming it. Each
model gets at most one retry, and two failures open a 60-second circuit breaker so a repeatedly
failing model is skipped until it recovers. Failed models are recorded as failed attempts and are
never reported as successful fallbacks.

`openrouter/google/gemma-4-26b-a4b-it:free` remains in the five-model free chain but is marked
**unsuitable for automatic agent/tool-calling work**: a real OpenRouter/OpenCode probe returned
HTTP `429` with `limit_source: upstream_provider_shared_pool` for both plain text and tool-calling
requests. The verified free replacement for automatic building is `opencode/big-pickle`, with
`opencode/deepseek-v4.1-flash-free` and `opencode/flint-40b-free` as verified free alternates.

## Core features (roadmap)

- AI coding chat with conversation history.
- Create and edit Android Kotlin/Jetpack Compose projects.
- GitHub authentication and repository integration.
- Create commits and manage project files.
- Cloud-based builds using GitHub Actions.
- Build status and live progress updates.
- Signed APK generation and browser-friendly download links.
- Image uploads and image understanding.
- Image generation integration.
- Real-time web search.
- Persistent cloud tasks that continue when the phone disconnects.
- Clear error reporting and recovery.

## Repository layout

- `android/` — native Android application (Kotlin + Jetpack Compose).
- `docs/` — architecture, build order, security, testing and progress.
- `.github/workflows/` — CI pipelines.

## Build

The Android project is under `android/`. CI runs unit tests, lint, an emulator launch smoke test
and assembles a debug APK on GitHub-hosted runners.

## Current status

Batch 1 (foundation) is **COMPLETE** with green CI run `45274532780`: 3 Android unit tests,
19 backend core tests, lint, API 35 emulator smoke test and debug APK evidence. Debug APK
SHA-256: `b3e4729c46e479c4fd9b70712e522117739a726d92e4ca4592235e9d7ca9d104`. No hosted
backend, GitHub integration, signed release or AI chat endpoint is deployed yet.

See `docs/BUILD_ORDER.md` for the dependency-first plan and batch gates, `docs/PHASE_2.md` for the
Cloud AI Engine phase, and `docs/PROGRESS.md` for detailed evidence.

## Phase 2 status

Phase 2 implementation and verification are **complete** on commit `9ccee3d`:

- `Cloud Backend CI` `45347166634`: **success** (8 tests, health smoke, container build).
- `Android CI` `45347166635`: **success** (unit tests, backend core tests, lint, API 35 emulator,
  APK/secret scan and an HTTPS backend integration test with 1 passed, 0 skipped).
- Real provider probes returned `MODELTEST` from `opencode/big-pickle`,
  `opencode/deepseek-v4.1-flash-free` and `opencode/flint-40b-free`; OpenRouter free models returned
  real upstream `429` rate-limit responses.
- SQLite chat history persists across backend restarts; the five-model fallback order and automatic
  switching are covered by controlled tests.

Permanent production hosting, a TLS domain and backend `OPENROUTER_API_KEY` secret are external
follow-on dependencies; HTTPS was verified through a temporary tunnel, not a deployed domain. See
`docs/PHASE_2.md` and `docs/PROGRESS.md` for full evidence and blockers.

## Phase 3 status

Phase 3 started from the Phase 2 HEAD without rewriting it. All batches 3.1–3.5 are implemented:
server-side GitHub OAuth with encrypted token storage, repository management, AI-assisted file
editing, GitHub commits, Actions dispatch/monitoring, APK artifact delivery with browser-openable
single-use links, launcher icon templates and signed-release workflows referencing only protected
GitHub Actions secrets. Success is reported only from actual GitHub conclusions. 30 backend tests
pass (8 Phase 2 + 22 Phase 3). Live verification requires an OAuth App, HTTPS callback domain,
client ID/secret, a 32-byte token encryption key and repository signing secrets as documented in
`docs/PHASE_3.md`. Final Phase 3 CI is green on `45360550913` (Cloud Backend) and `45360550873`
(Android). No production/live build is claimed.

## Phase 4 status

Phase 4 started from `54e2d49`. Independent work for Batches 4.1–4.5 is implemented: masked
configuration readiness checks, protected file/AI edit guards, encrypted-token tests, APK SHA-256
checksums, and GitHub Actions templates that verify signatures and emit evidence artifacts. **38
backend tests pass**. Live OAuth, real repository commits, real Actions conclusions, real APK
signature verification and real-device installation remain blocked until the OAuth App, deployed
HTTPS backend, AI key, signing secrets and browser authorization described in `docs/PHASE_4.md` and
`docs/GITHUB_OAUTH_SETUP.md` are provided. No live-service or production-release claim is made.

## Phase 5 status

Phase 5 started from the unchanged Phase 4 checkpoint `d136bda`. It proceeds in dependency order
from deployment readiness (5.1) through GitHub OAuth, repository connection, real Actions
orchestration, signed APK delivery and physical-device verification (5.6). The container deployment
contract and masked preflight checks are in `docs/DEPLOYMENT.md`; per-batch evidence is in
`docs/PHASE_5.md`. Work that requires external credentials, browser consent, signing secrets or a
physical device is implemented around the dependency and recorded as blocked, never fabricated. See
`docs/DEPLOYMENT.md` for the deployment contract and `docs/DEVICE_TESTING.md` for physical-device
evidence. No live OAuth, signed APK or device claim is made without actual evidence.

All six batches (5.1–5.6) are implemented with 60 backend tests passing and both CI workflows green on
implementation commit `417cc2b` (`Cloud Backend CI` `45443444610`, `Android CI` `45443444436`). A
GHCR image-publish workflow and a Compose/Caddy single-host HTTPS deployment shape are provided in
`.github/workflows/publish-backend-image.yml` and `deploy/`; they are artifacts, not a live deployment.
Live OAuth, a deployed HTTPS backend, an application-dispatched GitHub Actions run, a real signed
APK and physical-device verification remain externally blocked; no such result is claimed without
evidence. A real **debug** APK artifact from CI was downloaded and SHA-256 verified as a build
artifact only (see `docs/PHASE_5.md`); it is not a signed production release.

## Phase 6–8 status — advanced features

The advanced backlog is now split into three phases and implemented on top of the unchanged Phase 5
checkpoint:

- **Phase 6 — Image uploads and image understanding:** owner-scoped upload, magic-byte validation,
  persistent storage, authenticated content retrieval and a free OpenRouter vision-analysis path.
  Upload/storage is verified; live vision is blocked on `OPENROUTER_API_KEY`. See `docs/PHASE_6.md`.
- **Phase 7 — Image generation:** free keyless Pollinations integration with fixed-host SSRF
  protection, size/prompt limits and storage through the Phase 6 pipeline. **Live verified**: a real
  512px JPEG was generated, persisted, re-read after a backend restart and SHA-256 matched
  (`62ac8e0945cea1df95145fd773e2e7a2163e9ce1919112974af52289c20f9169`). See `docs/PHASE_7.md`.
- **Phase 8 — Real-time web search and persistent cloud tasks:** live DuckDuckGo search results,
  search-grounded chat with citations, and SQLite-backed tasks that survive backend restarts.
  **Live verified**. See `docs/PHASE_8.md`.

Backend suite after these phases: **74 tests passed, 0 failed**. Latest verified source checkpoint
`a0d6b21` is green: `Cloud Backend CI` `45510042756` (74/74 tests), `Android CI` `45510042640`
(unit tests, lint, debug APK, API 35 emulator smoke, and an HTTPS integration test that now exercises
image upload/list/analysis, generation, search and the task lifecycle) and `Publish backend image`
`45510042718` all succeeded. The downloaded debug APK SHA-256 is
`58c32b837915ebb8c0eff6e9ac0d33d661543a50ffd4f7d9661efdaf720437a8` (debug only). The authoritative
status and remaining external blockers are in `docs/MASTER_COMPLETION_TRACKER.md`. Production
release gates (deployed HTTPS backend, real GitHub OAuth consent, signing secrets, signed APK and
physical device) are still outstanding.