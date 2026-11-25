# Cloud OpenCode

Cloud OpenCode is an AI-powered cloud app-building platform. Users chat with an AI agent to
create and modify Android applications, connect GitHub repositories, run cloud builds, and
download signed APKs. Cloud tasks continue running even when the user's phone disconnects.

## Product rules

- Build and release through GitHub Actions. No local Android SDK build is required.
- Secrets and signing material must never be committed to this public repository.
- AI model access uses free models only, with an automatic fallback chain.
- Android targets Android 8 (API 26) and later.

## Current verification checkpoint

- Final Phase 9 code checkpoint: `5a0def3`; all six push workflows are green on this commit. See
  [`docs/PHASE_9.md`](docs/PHASE_9.md) for the production-readiness audit and
  [`docs/FINAL_AUDIT_REPORT.md`](docs/FINAL_AUDIT_REPORT.md) for the complete 8-phase audit.
- `Android CI` [`45652195081`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652195081)
  and `Cloud Backend CI` [`45652195102`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652195102)
  are green; the backend suite is **118 passed, 0 failed**.
- `Production readiness` [`45652195282`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652195282),
  `Dependency audit` `45652195100`, `Publish backend image` `45652194998`, and
  `Submit dependency graph` [`45652195047`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652195047)
  attempt 2 are green. Earlier dependency-submission API failures are documented in Phase 9.
- Live AI verification [`45653061448`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45653061448)
  and release readiness [`45653254004`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45653254004)
  completed honestly with status `BLOCKED` because provider keys and a deployed HTTPS backend are absent.
- Debug APK delivery was re-verified end-to-end on code checkpoint `73d4289`: artifact
  `15027061074` (`cloud-opencode-debug`), `app-debug.apk` **10,333,811 bytes**, SHA-256
  `6b65de0f61e50e30a342cb006e0f76232402a9d587d3e56af0b26abcfebccc71`. All 20 delivery checks
  passed, including download without an `Authorization` header and a rejected single-use grant
  replay (403).
- That artifact is a **debug** APK. A self-signed signed release was also produced and verified;
  production signing and a real public HTTPS backend remain blocked, as described below.

## AI model system

Free models only. Fallback chain (in priority order):

1. `opencode/big-pickle`
2. `opencode/deepseek-v4.1-flash-free`
3. `opencode/flint-40b-free`
4. `openrouter/baidu/ernie-5.5-flash-preview:free`
5. `openrouter/google/gemma-4-26b-a4b-it:free`

The agent switches to the next available model after eligible provider errors, rate limits or
exhausted quotas, with bounded per-attempt timeouts and exponential backoff. It avoids infinite
retries; availability is discovered by attempting the next model in order.

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
evidence. A real **debug** APK artifact from CI was downloaded through the backend's one-time
browser-download link and SHA-256 verified (see the Android client status below); it is not a signed
production release.


## Android client status

The Android app now has a functional Compose client rather than a static shell. It supports
authentication, chat, GitHub repository management, project file editing, commits, build monitoring,
cloud tasks, and image generation. The Builds screen loads artifacts for a successful build, selects
the APK artifact automatically, creates a 10-minute single-use browser-downloadable link, opens it,
and displays build status, APK filename, size, expiry, and SHA-256. The GitHub tab starts OAuth and
the app now handles the `cloudopencode://github/callback` deep link to refresh connection state.

**APK delivery is live-verified** on code checkpoint `73d4289` against `Android CI` run
`45622989945` (all jobs green). The backend created a grant link for artifact `15027061074`
(`cloud-opencode-debug`) and the link was downloaded **without any Authorization header**. The
downloaded `app-debug.apk` is **10,333,811 bytes** with SHA-256
`6b65de0f61e50e30a342cb006e0f76232402a9d587d3e56af0b26abcfebccc71`; the checksum endpoint returned
the same value, the response used `Content-Type: application/vnd.android.package-archive`, the grant
was single-use, and all 20 delivery checks passed. The same flow was first verified on `b06911a`
(run `45600319235`, SHA-256 `c0c9322b...`). This is a debug APK, not a signed release.

The signed release workflow (`.github/workflows/android-release.yml`) is implemented and gated on
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`, and a public `CLOUD_BASE_URL`. A self-signed keystore has since been placed
in repository Actions secrets and the workflow has been run successfully; see the signed release
section below. Physical-device verification remains blocked because no `adb`-connected device is
available; the API 35 emulator smoke test is green in CI but is not a physical device.

### Signed release run (self-signed key)

The release workflow was executed on `main` after storing a self-signed release keystore in GitHub
Actions secrets (`gh secret set`, never committed) and passing the public backend URL as a workflow
input. It succeeded: `Android signed release` run
[`45629726291`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45629726291).

- Signed APK: `app-release.apk`, **1,567,651 bytes**, SHA-256
  `4b6bab61cb87e86aa64e53504a9166d558b3c3e31037203a95ed61414c7b52e4`.
- `apksigner verify --verbose --print-certs`: **Verified**, APK Signature Scheme **v2** verified,
  signer certificate `CN=Cloud OpenCode, OU=Release, O=SikoroApps, L=Internet, ST=Internet, C=US`,
  certificate SHA-256 digest `374985d10e1c1c126bf39965782ba59b98a0a35f4b4c43e3b27013428185788e`,
  RSA 4096-bit key.
- `aapt dump badging`: package `com.sikorokoro44.cloudopencode`, versionCode 1, versionName 0.1.0,
  `minSdkVersion 26`, `targetSdkVersion 35`, launchable activity
  `com.sikorokoro44.cloudopencode.MainActivity`.

The workflow initially failed with `KeytoolException: keystore not found` because AGP rejected the
`android.injected.signing.store.type=keystore` value; the run now uses the valid KeyStore type `jks`
and passes the keystore via the absolute path `ANDROID_KEYSTORE_PATH`. The final run is green.

The signed APK is produced with a **self-signed release certificate** and with the backend URL
`https://cloud-opencode-backend.example` supplied at build time, so it is not yet a production release
backed by a real public HTTPS deployment. Live delivery against a real backend remains **BLOCKED**;
the signature/release-pipeline step itself is **VERIFIED**.

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

The Phase 8 backend suite was **96 passing tests, 0 failed**; the final Phase 9 suite is **118
passed, 0 failed** (see the current checkpoint above). The HTTPS integration test exercises image
upload/list/analysis, generation, search and the task lifecycle in addition to APK delivery. The
authoritative status and remaining external blockers are in
`docs/MASTER_COMPLETION_TRACKER.md`. Production release gates (deployed HTTPS backend, real GitHub
OAuth consent, provider keys, production signing identity and physical device) are still outstanding.

## Phase 9 status — production readiness

Phase 9 preserves Phases 1–8 and the exact five-model fallback order while adding deployable
configuration, fail-fast production config validation, masked live-AI/release-readiness gates, and
secret-safe GitHub Actions workflows. Implementation commits: `10c7e0d` → `9974d00` → `86d4c91` →
`5a0def3`; test counts progressed 98 → 105 → 111 → 118, all with 0 failures.

Production backend deployment, live OAuth consent, live provider inference, production signing
identity, and physical-device verification remain explicitly **BLOCKED**/**NOT TESTED** because the
required host, OAuth app, API keys, production key and device are not present here. See
[`docs/PHASE_9.md`](docs/PHASE_9.md) for exact evidence, run IDs and unresolved blockers.

### Before downloading for production use

Do not distribute the current APK as a production release yet. The debug APK is test-only, and the
signed APK is self-signed with the placeholder backend URL. First: deploy a real HTTPS backend,
complete live GitHub OAuth consent, configure a provider key and pass `npm run verify:ai --
--require-live`, switch to a production signing identity, rebuild with the real `CLOUD_BASE_URL`,
pass `Release readiness` with `require_live=true`, verify the APK SHA-256/signature, and complete a
physical-device smoke test. See the full checklist in
[`docs/PHASE_9.md`](docs/PHASE_9.md#81-before-downloading-cloud-opencode-builder).