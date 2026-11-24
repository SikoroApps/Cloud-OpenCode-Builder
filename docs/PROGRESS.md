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

Status: **IN PROGRESS** — local implementation complete; final HTTPS integration CI, permanent
deployment and provider credentials remain.

### Implemented

- Node.js cloud backend (`cloud/`): health, auth, chat, model and history endpoints; scrypt password
  hashing, hashed bearer sessions, SQLite chat persistence, AI fallback chain, OpenCode/OpenRouter
  adapters, Dockerfile and env-only configuration.
- Android cloud client: HTTPS enforcement, optional allowlist, register/login/logout/chat/history/
  health methods, Android Keystore token encryption, secure URL tests and an instrumented HTTPS
  integration test.
- CI: backend tests + health smoke + container build; Android unit tests, backend core tests, lint,
  emulator smoke test, APK assembly, secret scan and a temporary HTTPS tunnel integration job.

### Verified evidence

- Cloud backend tests: **8 passed, 0 failures** locally and in CI.
- API integration test: auth and chat history survive a backend restart (AI stubbed, simulated).
- Backend live smoke: health, auth, history and fallback-exhausted chat response.
- Real OpenCode provider probes:
  - `opencode/big-pickle`, `opencode/deepseek-v4.1-flash-free` and `opencode/flint-40b-free` all
    returned assistant text `MODELTEST`.
  - OpenCode stateless generate route returned a real `429 rate_limit` error.
- Direct OpenRouter probes for both required free models returned real upstream `429`
  temporary-rate-limit responses; no successful live OpenRouter response was observed.
- Fallback tests are controlled/simulated and assert exact order, eligible errors, automatic
  switching, non-eligible stop and exhaustion. They are not live availability claims.

### CI evidence (2026-11-24)

- `Cloud Backend CI` `45340096468` on `94470f6`: **success**.
- `Android CI` `45340096492` on `94470f6`: **failure** (Phase 2 compile errors).
- `Cloud Backend CI` `45344526350` on `48d98d8`: **success**.
- `Android CI` `45344526434` on `48d98d8`: **failure** (remaining compile errors).
- `Cloud Backend CI` `45345330402` on `ba749e8`: **success** (8 tests, health smoke, container build).
- `Android CI` `45345330348` on `ba749e8`: **success** (unit tests, backend tests, lint, emulator
  smoke, APK and secret scan).
- `Cloud Backend CI` `45345888090` on `d5bb65d`: **success**.
- `Android CI` `45345888322` on `d5bb65d`: final HTTPS integration verification in progress.

### Remaining blockers

- Permanent cloud hosting, HTTPS domain and TLS configuration were not provided.
- `OPENROUTER_API_KEY` is not configured as a backend secret; OpenRouter free models were rate-limited
  upstream during direct probes.
- OpenCode free quotas can be exhausted; no availability is assumed without a fresh probe.
- No separate Supabase project/credentials exist; the Messenger Pro project must not be reused.
- Phase 2 remains incomplete until the final HTTPS integration CI run is green.
