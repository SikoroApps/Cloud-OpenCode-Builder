# Build order and batch gates

Cloud OpenCode follows a dependency-first approach. Each batch must pass its documented exit
criteria before dependent work starts.

## Batch 1 — Foundation (COMPLETE — CI run 45274532780)

Scope:
- Repository skeleton and documentation.
- Native Android application (Kotlin + Jetpack Compose) with launcher icon.
- CI pipeline: unit tests, lint, emulator launch smoke test, debug APK assembly and artifact upload.
- Secret-safe client build configuration.

Exit criteria:
- CI green on the exact final HEAD.
- Unit tests and emulator smoke test passing.
- Debug APK assembled and package name verified.
- No secrets in tracked files or build artifacts.

## Batch 2 — AI chat and cloud backend (COMPLETE — Phase 2)

Scope:
- Cloud backend for chat history and task persistence.
- AI model fallback integration with the exact five-model free chain.
- Authentication and session management.
- Deployable container, SQLite persistence and HTTPS Android client.

Evidence: `docs/PHASE_2.md`, `docs/PROGRESS.md`.
Final Phase 2 CI: `45348660432` (Android) and `45348660296` (Cloud Backend), both success.

## Batch 3.1 — GitHub authentication (IMPLEMENTED, LIVE BLOCKED BY CREDENTIALS)

Dependency: Phase 2 authenticated cloud backend and HTTPS Android client.

Scope:
- Server-side GitHub OAuth start/callback with unguessable state and expiry.
- Token exchange, encrypted token-at-rest storage, connection status and disconnect.
- Tokens never returned to Android, logged or committed.
- Backend unit/API tests and Android HTTPS client coverage.

Exit criteria:
- GitHub OAuth endpoints return `github_not_configured` safely when no credentials are set.
- With a mocked GitHub provider, start/callback/status/disconnect work and no token is exposed.
- CI green; Phase 2 tests remain green.
- Exact external setup documented without inventing credentials.

## Batch 3.2 — Repository management (IMPLEMENTED, LIVE BLOCKED BY 3.1 CREDENTIALS)

- List accessible repositories through the backend using the stored token.
- Select a repository and create a new public repository for each new app project.
- Never reuse or update an existing app repository unless explicitly requested.
- CI green: `45353275993` (Cloud Backend) and `45353276135` (Android).

## Batch 3.3 — Cloud code editing and commits (IMPLEMENTED, LIVE BLOCKED BY 3.1 CREDENTIALS)

- AI-assisted create/inspect/modify project files in backend storage.
- Commit changes to the selected repository with accurate commit status and errors.
- Backend tests: 21 passed locally; CI green on `45355223253` (Cloud Backend) and `45355223014`
  (Android).

## Batch 3.4 — GitHub Actions build orchestration (IMPLEMENTED, LIVE BLOCKED BY 3.1 CREDENTIALS)

- Trigger Android builds through GitHub Actions.
- Monitor workflow runs and progress; retrieve logs and report only actual results.
- Backend tests: 24 passed locally; CI green on `45357090689` (Cloud Backend) and `45357090706`
  (Android).

## Batch 3.5 — APK delivery and signed release preparation (BLOCKED BY 3.4 LIVE VERIFICATION)

- Retrieve successful APK artifacts and expose a browser-friendly download link.
- Include app icons in builds.
- Prepare signed release APK support using protected GitHub secrets; never commit signing material.

## Batch 4 — Advanced features (planned)

- Image uploads/understanding and image generation.
- Real-time web search.
