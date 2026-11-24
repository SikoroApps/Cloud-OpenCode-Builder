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

The deployable cloud backend, five-model fallback engine, SQLite chat persistence and HTTPS-only
Android client are implemented under `cloud/` and `android/`. Backend tests and container build are
green (`Cloud Backend CI` `45345888090`); Android unit/lint/emulator/APK checks were green on
`ba749e8` (`Android CI` `45345330348`). Real provider probes returned `MODELTEST` from
`opencode/big-pickle`, `opencode/deepseek-v4.1-flash-free` and `opencode/flint-40b-free`; OpenRouter
free models returned real upstream `429` rate-limit responses.

Final HTTPS integration CI is being verified in `Android CI` `45345888322`. Permanent hosting, a TLS
domain and backend `OPENROUTER_API_KEY` secret are external dependencies, so Phase 2 is not yet
complete. See `docs/PHASE_2.md` and `docs/PROGRESS.md` for full evidence and blockers.