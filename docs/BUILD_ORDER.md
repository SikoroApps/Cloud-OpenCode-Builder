# Build order and batch gates

Cloud OpenCode follows a dependency-first approach. Each batch must pass its documented exit
criteria before dependent work starts.

## Batch 1 — Foundation (in progress)

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

## Batch 2 — AI chat and cloud backend (planned)

- Cloud backend for chat history and task persistence.
- AI model fallback integration.
- Authentication and session management.

## Batch 3 — GitHub integration and builds (planned)

- GitHub OAuth and repository connection.
- Commit/file management.
- GitHub Actions build orchestration and APK download links.

## Batch 4 — Advanced features (planned)

- Image uploads/understanding and image generation.
- Real-time web search.
- Signed release builds.