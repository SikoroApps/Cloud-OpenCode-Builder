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
exhausted quotas. It avoids infinite retries and verifies availability before claiming it.

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
`docs/PHASE_3.md`. No production/live build is claimed.