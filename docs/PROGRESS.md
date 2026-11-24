# Progress

## Batch 1 — Foundation

Status: **COMPLETE** with CI evidence.

### Verified evidence

- Repository: `SikoroApps/Cloud-OpenCode-Builder`, branch `main`.
- Latest CI run `45274532780` on commit `e3127c7`: **success** (both jobs).
  https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45274532780
  (previous green run `45273309014` on `9c4dac4`)
- Android unit tests: 3 passed, 0 failures (artifact
  `cloud-opencode-unit-test-results`).
- Backend core tests: 19 passed, 0 failures (artifact
  `cloud-opencode-backend-test-results`).
- Android lint: passed.
- Emulator app-launch smoke test (API 35): passed.
- Debug APK: `com.sikorokoro44.cloudopencode.debug`, SHA-256
  `b3e4729c46e479c4fd9b70712e522117739a726d92e4ca4592235e9d7ca9d104`.
- Secret-marker scan on the built APK: passed.

### Implemented

- Repository skeleton, README and documentation.
- Native Android application (Kotlin + Jetpack Compose) with launcher icon.
- Pure-JVM backend core module with:
  - the five-model free fallback chain and eligible error classification;
  - in-memory cloud task repository with lifecycle status transitions;
  - build orchestration state machine with monotonic progress and artifact links;
  - least-privilege GitHub scope contracts and connected-repository metadata.
- CI pipeline: unit tests, backend tests, lint, emulator smoke test, debug APK assembly,
  package-name verification and secret-marker scan.

### Still not implemented (roadmap)

- Deployed cloud backend and persistent task storage.
- GitHub authentication and repository integration.
- Cloud build orchestration and APK download links.
- Image understanding/generation and web search.
- Signed release builds.

## Phase 2 — Cloud AI Engine

Status: **IN PROGRESS** — local implementation and verification complete; cloud deployment and final CI evidence pending.

Implemented:

- Node.js cloud backend (`cloud/`): health, auth, chat, model endpoints; scrypt password hashing, hashed bearer sessions, SQLite chat persistence, AI fallback chain and providers.
- Android cloud client: HTTPS enforcement, allowlist, register/login/chat/history/logout client, encrypted token store, secure URL tests.

Verified locally:

- Cloud backend tests: 7 passed, 0 failures.
- Backend live smoke: health, auth, chat history and chat fallback-exhausted response.
- Real OpenCode provider: `opencode/big-pickle` succeeded; stateless generate route returned real `429 rate_limit`.

Remaining blockers:

- OpenCode free quota reached; OpenRouter credentials not configured; cloud deployment pending; final CI evidence pending.