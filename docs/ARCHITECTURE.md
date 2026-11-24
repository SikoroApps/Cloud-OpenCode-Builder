# Architecture

## Components

- **Android client** (`android/`): Kotlin + Jetpack Compose, minSdk 26. Communicates with the
  cloud backend over HTTPS only. Stores OAuth/session material in Android Keystore-backed encrypted
  storage; no provider key is embedded in the APK.
- **Cloud backend** (`cloud/`): Node.js 22 service that hosts auth, chat history, the free five-model
  text fallback chain, image upload/understanding/generation, GitHub integration, build
  orchestration, artifact delivery, real-time web search and persistent cloud tasks.
- **SQLite persistence**: users, sessions, chat history, OAuth state/connections, projects, project
  files/commits/builds, download grants, images and cloud tasks. In the container the database lives
  under `/data`, which must be a persistent volume.
- **GitHub Actions**: performs Android builds and produces APK/evidence artifacts. The backend never
  runs an Android SDK locally.

## AI and media services

- Text chat uses the approved free fallback chain in `cloud/src/ai.ts`. The order is unchanged:
  `opencode/big-pickle`, `opencode/deepseek-v4.1-flash-free`, `opencode/flint-40b-free`,
  `openrouter/baidu/ernie-5.5-flash-preview:free`, `openrouter/google/gemma-4-26b-a4b-it:free`.
- Image understanding uses a free OpenRouter vision model over `OPENROUTER_API_KEY`; the key is
  backend-only.
- Image generation uses a fixed free Pollinations endpoint. The prompt is encoded and the response is
  validated as an image before storage.
- Web search uses the fixed DuckDuckGo HTML endpoint and parses results into plain text/URLs.

## Security boundaries

- The client stores only non-secret endpoint settings (`CLOUD_BASE_URL`, `CLOUD_HOST_ALLOWLIST`).
- No API keys, GitHub tokens, signing material or provider credentials are embedded in the APK.
- All client traffic uses HTTPS; cleartext is disabled in the manifest and the client rejects
  non-HTTPS backend URLs.
- GitHub tokens are encrypted at rest with AES-256-GCM and never returned to the client.
- User content and uploaded/generated images are scoped to the owning user and optional project.
- Image and search providers are reached through fixed backend-selected hosts; client input cannot
  choose an arbitrary upstream URL.
- APK downloads use short-lived, hashed, single-use grants; direct artifact bytes are never exposed
  without authentication or a valid grant.
