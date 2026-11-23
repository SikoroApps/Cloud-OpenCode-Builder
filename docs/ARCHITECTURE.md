# Architecture

## Components

- **Android client** (`android/`): Kotlin + Jetpack Compose, minSdk 26. Communicates with the
  cloud backend over HTTPS only.
- **Cloud backend** (planned): hosts AI chat, task persistence, GitHub integration and build
  orchestration. Never ships secrets to the client.
- **GitHub Actions**: performs Android builds and produces APK artifacts.

## Security boundaries

- The client stores only non-secret endpoint settings (`CLOUD_BASE_URL`, `CLOUD_HOST_ALLOWLIST`).
- No API keys, tokens or signing material are embedded in the APK.
- All network traffic uses HTTPS; cleartext is disabled in the manifest.