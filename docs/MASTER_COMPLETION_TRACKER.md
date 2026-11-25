# Master completion tracker

Last updated: 2026-11-25

This is the single persistent status record for Phases 1–8. It records what is implemented, what was
actually verified, and what remains externally blocked. Historical phase documents and CI run IDs are
preserved; this tracker does not overwrite earlier evidence.

Status vocabulary:

- **COMPLETE** — implemented and verified with evidence appropriate to the requirement.
- **IMPLEMENTED** — code exists and automated tests pass, but full live verification is incomplete.
- **BLOCKED** — an external credential, service, browser consent or device prevents completion.
- **FAILED** — verification failed and remains unresolved.
- **NOT STARTED** — work has not begun.

## Overall result

| Area | Result | Evidence / blocker |
| --- | --- | --- |
| Phase 1 — Foundation | **COMPLETE** | Historical green `Android CI` `45274532780`; Android/backend unit tests, lint, emulator launch and debug APK. |
| Phase 2 — Cloud AI engine | **COMPLETE** (automated + real provider probes) | 8 Phase 2 tests; real OpenCode `MODELTEST`; OpenRouter real `429`; HTTPS tunnel integration. Permanent hosting remains a Phase 5 blocker. |
| Phase 3 — GitHub integration | **IMPLEMENTED** (live **BLOCKED**) | 30 tests at the Phase 3 gate; OAuth, repositories, file editing, commits, Actions, artifact links. No live OAuth App/browser consent here. |
| Phase 4 — Live integration and release verification | **IMPLEMENTED** (live **BLOCKED**) | 38 tests at the Phase 4 gate; encrypted tokens, protected paths, APK evidence parsing, signed-release template. A self-signed signed release has since run; live OAuth consent is still blocked. |
| Phase 5 — Deployment and first real APK | **IMPLEMENTED** (live **BLOCKED**) | 60 tests at the Phase 5 gate; deployment checker, GHCR image publish success, Caddy/Compose shape; debug APK delivery and a self-signed signed APK are verified. Real public backend and physical device remain blocked. |
| Phase 6 — Image uploads and understanding | **IMPLEMENTED** (live understanding **BLOCKED**) | Upload/storage/ownership verified; vision service requires `OPENROUTER_API_KEY`; controlled tests only for understanding. |
| Phase 7 — Image generation | **COMPLETE** | 3 module tests + HTTP generation test; live Pollinations JPEG generated, stored, re-read after restart and SHA-256 matched. |
| Phase 8 — Web search and persistent tasks | **COMPLETE** | 5 tests; live DuckDuckGo search returned real results; tasks persisted across a real backend restart. |

Backend automated test suite after the APK-delivery/OAuth/provider/scaffold/release work: **96
passed, 0 failed** (`cd cloud && npm test`). This includes all earlier phase tests plus provider,
release-workflow, APK-delivery, atomic-grant, Android-scaffold and bounded artifact-body tests; no
test was removed or weakened.

### Current HEAD verification (`73d4289`)

- `Android CI` [`45622989945`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45622989945)
  — unit tests, lint, debug APK, API 35 emulator smoke and HTTPS integration all green.
- `Cloud Backend CI` [`45622989755`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45622989755)
  — 95/95 backend tests at that checkpoint; the bounded artifact-body hardening adds one more test
  (96 total).
- `Publish backend image` `45622989500`, `Dependency audit` `45622989569`,
  `Submit dependency graph` `45622989468` — all green.
- Debug APK delivery re-verified on this HEAD: artifact `15027061074`, `app-debug.apk`
  **10,333,811 bytes**, SHA-256
  `6b65de0f61e50e30a342cb006e0f76232402a9d587d3e56af0b26abcfebccc71`, 20/20 checks, no
  `Authorization` header, grant replay `403`.

Rough verified-requirement completion: **8 of 8 phase areas have complete or implemented automated
verification; Phases 7 and 8 and debug APK delivery have live feature-level verification.** Live
production release gates (live OAuth consent, deployed HTTPS backend, production signing key,
physical device) remain blocked. The release pipeline and a self-signed APK signature are verified,
but the project is **not** a finished production release.


## Android APK delivery, OAuth and release update

**APK delivery — live verified (debug APK).** The Builds screen calls
`/api/projects/build/artifacts`, selects the APK artifact, then uses
`/api/projects/build/artifact/link` and `/api/projects/build/artifact/checksum`. The generated link is
a 10-minute, single-use browser URL that needs no GitHub token or Authorization header. Grants are
consumed with a single atomic `DELETE ... RETURNING` so two concurrent requests cannot both succeed.
Verification on current HEAD `73d4289`, `Android CI` run
[`45622989945`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45622989945)
(all jobs green), artifact `15027061074` (`cloud-opencode-debug`):

- downloaded `app-debug.apk` via the grant link with **no Authorization header**;
- size **10,333,811 bytes**;
- SHA-256 `6b65de0f61e50e30a342cb006e0f76232402a9d587d3e56af0b26abcfebccc71`, identical in the
  `X-APK-Sha256` header, the checksum endpoint, and `sha256sum` of the saved file;
- `Content-Type: application/vnd.android.package-archive`, `Content-Disposition: attachment`;
- a replayed grant returned `403`, and an unauthenticated request without a grant returned `401`;
- 20 of 20 end-to-end delivery checks passed (`cloud/scripts/verify-apk-delivery.mjs`).

The same flow was first verified on `b06911a` (`Android CI` `45600319235`, artifact `15015027414`,
10,251,891 bytes, SHA-256 `c0c9322b810ced52b98b813a427aec8b011ed013f9c133aed2ecf1e0228c69ae`).
This proves browser APK delivery for a **debug** artifact. It is not a signed production release.

**GitHub OAuth — implemented, live consent still blocked.** The app declares the
`cloudopencode://github/callback` deep link, handles `onCreate`/`onNewIntent`, refreshes GitHub status
after a successful callback, and maps denial/scope/state errors to actionable messages. Live OAuth
still requires a real OAuth App, an HTTPS callback domain, a deployed backend and browser consent.

**OpenRouter free models — implemented and hardened.** The five-model chain is unchanged. The
OpenRouter provider now fails fast with `openrouter_api_key_not_configured` instead of constructing an
invalid provider, sends `HTTP-Referer`/`X-Title` attribution headers, and maps provider errors for
fallback decisions. Live OpenRouter inference remains blocked on `OPENROUTER_API_KEY`.

**Signed APK release — now run and verified (self-signed key).**
`.github/workflows/android-release.yml`
is manual-only, requires all four Android signing secrets plus an HTTPS `CLOUD_BASE_URL`, builds
`assembleRelease` with injected signing, verifies with `apksigner`, and uploads the APK and evidence.
It has now run successfully (`Android signed release` run
[`45629726291`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45629726291)) using a
self-signed release keystore stored in repository Actions secrets. `apksigner verify --verbose
--print-certs` reported **Verified** (APK Signature Scheme v2 verified, RSA 4096 signer); the signed
APK is 1,567,651 bytes with SHA-256
`4b6bab61cb87e86aa64e53504a9166d558b3c3e31037203a95ed61414c7b52e4`. The release run initially failed with
`KeytoolException: keystore not found` and was fixed by using the valid KeyStore type `jks`; the
successful run is the final state. The signed APK carries the build-time backend URL supplied as the
workflow input (`https://cloud-opencode-backend.example`), so live delivery against a real public HTTPS
backend remains BLOCKED; signature and release-pipeline verification itself are VERIFIED.

**Physical device — blocked.** No `adb` binary or connected device is available locally. The API 35
emulator smoke job is green in CI, but that is not physical-device verification.

## Phase 1 — Foundation

| Requirement | Status | Evidence |
| --- | --- | --- |
| Kotlin + Jetpack Compose structure | COMPLETE | `android/app/src/main/java/.../MainActivity.kt`, Gradle Compose plugins. |
| MinSdk 26 / target 35 / package identity | COMPLETE | `android/app/build.gradle.kts`; debug package `com.sikorokoro44.cloudopencode.debug`. |
| Launcher icon | COMPLETE | Adaptive icon resources in `res/mipmap-anydpi-v26` and `res/drawable`. |
| Unit tests | COMPLETE | `BuildConfigurationTest`, `CloudApiClientSecureUrlTest`, `ApkDeliveryTest`, `GithubOAuthResultTest`; `Android CI` `45600319235` green. |
| Lint | COMPLETE | `./gradlew lintDebug` in `Android CI`. |
| Emulator launch smoke test | COMPLETE | API 35 emulator job `Emulator app-launch smoke test`. |
| Debug APK assembly | COMPLETE | Historical artifact, SHA-256 in `docs/PROGRESS.md`. |

## Phase 2 — Cloud AI engine

| Requirement | Status | Evidence |
| --- | --- | --- |
| Chat backend and persistence | COMPLETE | `cloud/src/server.ts`, `chat.ts`, SQLite `chat_messages`; restart test in `tests/api.test.ts`. |
| Exact five-model free fallback order | COMPLETE | `cloud/src/ai.ts` and `android/backend/.../ModelFallback.kt`; order unchanged. |
| Automatic fallback after eligible errors/rate limits | COMPLETE | `tests/ai.test.ts`; real OpenCode `429` observed historically. |
| Errors, timeouts, cancellation | COMPLETE (automated) | Per-attempt `AbortSignal.timeout` (20s) plus bounded exponential backoff; transport rejections continue the chain; fallback exhaustion maps to `503`. Covered by `tests/ai.test.ts`. |
| Android HTTPS client and Keystore token storage | COMPLETE | `CloudApiClient`, `EncryptedTokenStore`, HTTPS integration job. |
| Secret handling | COMPLETE | Env-only backend config; APK secret-marker scan in CI. |

## Phase 3 — GitHub integration and cloud builds

| Requirement | Status | Evidence |
| --- | --- | --- |
| GitHub OAuth with state/expiry | IMPLEMENTED | `phase5-oauth.test.ts`; live OAuth **BLOCKED**. |
| Encrypted token storage | COMPLETE (controlled) | AES-256-GCM tests in `phase4-hardening.test.ts`; live provider not used. |
| Repository list/create/connect + permissions | IMPLEMENTED | `phase5-repository.test.ts`; live repository **BLOCKED**. |
| AI-assisted file edit + protected paths | COMPLETE (controlled) | `files.test.ts`, `phase4-hardening.test.ts`. |
| Commit, Actions dispatch, status/logs | IMPLEMENTED | `phase5-build.test.ts`; no live dispatch. |
| APK artifact retrieval and browser link | COMPLETE (debug artifact) | `phase5-apk.test.ts` plus live 20/20 delivery verification on `73d4289`; signed artifact still **BLOCKED**. |
| New Android Compose starter project | COMPLETE (automated) | `cloud/src/scaffold.ts`, `tests/scaffold.test.ts`, `POST /api/projects/scaffold`: buildable Gradle/AGP/Kotlin-Compose project, launcher icons and cloud build workflow, with clobber protection. |
| Launcher icon integration | COMPLETE | `launcherIconFiles()`, build workflow icon check. |

## Phase 4 — Live integration and release verification

| Requirement | Status | Evidence |
| --- | --- | --- |
| Masked configuration readiness | COMPLETE | `readiness.ts`, `config-readiness.test.ts`, `check-config.mjs`. |
| OAuth/token security | COMPLETE (controlled) | Encryption/tamper/single-use state tests; OAuth callback has its own rate limit and callback URL scheme validation. |
| Atomic single-use download grants | COMPLETE (automated) | `consumeBuildDownloadGrant` uses one `DELETE ... RETURNING`; `tests/grants.test.ts` proves replay and expiry rejection. |
| Bounded artifact-body reads | COMPLETE (automated) | `readBoundedResponseBytes` caps streamed GitHub artifact bodies independently of `content-length`; `tests/github.test.ts` proves oversized streams are rejected. |
| Real workflow dispatch/result verification | IMPLEMENTED | `phase5-build.test.ts`; live dispatch **BLOCKED**. |
| APK integrity/package/version/ABI checks | IMPLEMENTED | `apk-evidence.ts`, `inspect-apk.mjs`; only debug APK inspected locally. |
| Signed release configuration | IMPLEMENTED | `signedReleaseWorkflow()`, secret names only; no signing values. |

## Phase 5 — Deployment and first real APK

| Requirement | Status | Evidence |
| --- | --- | --- |
| Deployable backend contract | COMPLETE (artifact) | `cloud/Dockerfile`, `deploy/`, `check-deployment.mjs`. |
| GHCR image publish | COMPLETE | `Publish backend image` run `45453671505` success on `7c77c06`. |
| Persistent SQLite volume | COMPLETE (configuration) | Compose volume; live deployment **BLOCKED**. |
| Permanent HTTPS backend | BLOCKED | No host/DNS/domain provided. |
| Real GitHub OAuth callback | BLOCKED | No OAuth App/client ID/secret/browser consent. |
| Real provider connectivity | PARTIAL | OpenCode probes and live DuckDuckGo/Pollinations in later phases; OpenRouter key missing. |
| Signed APK generation/verification | **VERIFIED (release pipeline, self-signed)** | Signed release run `45629726291` green; apksigner verified v2, SHA-256 `4b6bab...b52e4`, 1,567,651 bytes. Real public signing key / live backend delivery **BLOCKED**. |
| Browser download link | IMPLEMENTED | Single-use 10-minute grant endpoint; no live signed artifact. |
| Physical-device verification | BLOCKED | `scripts/verify-device.mjs` reports `adb_unavailable`. |

## Phase 6 — Image uploads and image understanding

| Requirement | Status | Evidence |
| --- | --- | --- |
| Upload validation (MIME magic bytes, size, path safety) | COMPLETE | `tests/phase6-images.test.ts`. |
| Persistent owner-scoped storage | COMPLETE | `images` table; HTTP tests. |
| Authenticated metadata/content retrieval | COMPLETE | `GET /api/images`, `/:id`, `/:id/content`. |
| Image understanding service | IMPLEMENTED | `images.ts` + injected tests; live **BLOCKED** on `OPENROUTER_API_KEY`. |
| Android client upload/analyze/list | IMPLEMENTED (compile/lint + HTTPS verified) | `CloudApiClient` methods; Android CI run `45510042640` compiled them and the emulator HTTPS test uploaded, listed and analyzed an image. No emulator UI screen was added or claimed. |

## Phase 7 — Image generation

| Requirement | Status | Evidence |
| --- | --- | --- |
| Free/keyless generation endpoint | COMPLETE | `POST /api/images/generate`; live Pollinations call. |
| Prompt/size validation and SSRF protection | COMPLETE | Fixed provider host, allowlisted sizes, encoded prompt; tests. |
| Generated image validation and storage | COMPLETE | Magic-byte check, 10 MiB cap, owner-scoped persistence. |
| Live generation and retrieval | COMPLETE | 512px JPEG, 17,277 bytes, SHA-256 `62ac8e0945cea1df95145fd773e2e7a2163e9ce1919112974af52289c20f9169`, re-read after restart. |
| Android client | IMPLEMENTED (compile/lint + HTTPS verified) | `CloudApiClient.generateImage`; Android CI run `45510042640` exercised stub generation over HTTPS. No in-app image display screen exists yet. |

## Phase 8 — Real-time web search and persistent cloud tasks

| Requirement | Status | Evidence |
| --- | --- | --- |
| Search endpoint with bounded input | COMPLETE | `POST /api/search`; `tests/phase8-web-search-tasks.test.ts`. |
| Real search provider | COMPLETE | Live DuckDuckGo HTML HTTP 200; real Android developer results parsed. |
| Search-grounded chat with citations | COMPLETE (controlled AI) | `webSearch: true` path; AI is stubbed in CI. |
| Persistent cloud tasks | COMPLETE | SQLite `cloud_tasks`; live create + restart list. |
| Owner scoping and status validation | COMPLETE | Tests cover cross-user 404 and invalid status 400. |
| Android client | IMPLEMENTED (compile/lint + HTTPS verified) | `webSearch`, `createTask`, `listTasks`, `updateTask`, `cancelTask`; Android CI run `45510042640` exercised search and the full task lifecycle over HTTPS. |

## Test and verification log (2026-11-24)

| Command / check | Result |
| --- | --- |
| `cd cloud && npm test` | **74 passed, 0 failed** |
| `cd cloud && npm run typecheck` | passed |
| `cd cloud && npm run check:config` | passed (masked output) |
| `cd cloud && npm run check:deployment` | passed (blockers reported, no values) |
| New Phase 6 tests | 6 passed |
| New Phase 7 tests | 3 passed |
| New Phase 8 tests | 5 passed |
| Live Pollinations generation | HTTP 201/200; JPEG; SHA-256 matched after restart |
| Live DuckDuckGo search | HTTP 200; real results parsed |
| Live task persistence | task survived backend restart |
| Android build/lint | delegated to Android CI (no local Android SDK in this environment) |

### CI evidence for verified checkpoint `cc662d0`

The Phases 6–8 checkpoint was pushed as commit `cc662d0` and all three workflows completed
successfully:

| Workflow | Run ID | Result | Evidence |
| --- | --- | --- | --- |
| Cloud Backend CI | `45503752952` | **success** | 73 tests, typecheck, masked config/deployment checks, health smoke, container build. |
| Android CI | `45503752923` | **success** | Unit tests, backend core tests, lint, debug APK assembly, package-name and secret-marker checks, API 35 emulator smoke test, and HTTPS backend integration test. |
| Publish backend image | `45503752574` | **success** | Backend image build/publish workflow completed. |

The debug APK artifact `cloud-opencode-debug` from Android CI run `45503752923` was downloaded and
hashed locally: **SHA-256 `28f0929e3f5b78e543324c00f82b6b3ff427cce61a50c15d0a4ba8a08149b068`**
(10,052,948 bytes). This is a **debug build artifact**, not a signed release APK. The CI steps that
verified its package name (`com.sikorokoro44.cloudopencode.debug`) and secret-marker scan passed.

These runs verify compilation, lint, automated tests, emulator launch and a temporary HTTPS
integration. They do not replace live OAuth consent, a deployed permanent backend, a signed release
APK or physical-device verification.

### CI evidence for hardening checkpoint `c385b48`

A follow-up commit hardened request/artifact input handling and extended the emulator HTTPS test to
cover the new endpoints. All workflows succeeded again:

| Workflow | Run ID | Result | Evidence |
| --- | --- | --- | --- |
| Cloud Backend CI | `45508407051` | **success** | **74/74 tests**, typecheck, masked config/deployment checks, health smoke, container build. |
| Android CI | `45508407058` | **success** | Unit tests, backend core tests, lint, debug APK, package-name and secret-marker checks, API 35 emulator smoke, and HTTPS integration covering image upload/list/analysis, generation, search and task create/update/cancel. |
| Publish backend image | `45508407050` | **success** | Backend image build/publish workflow completed. |

The debug APK artifact from Android run `45508407058` was downloaded and hashed locally:
**SHA-256 `540a29f82cb207c76ec589a0c5d03c51923f42f397ef1b6cad965d4605d2a542`** (10,052,948 bytes).
It remains a debug artifact, not a signed release APK.

### CI evidence for verified checkpoint `a0d6b21`

The final source checkpoint adds the DuckDuckGo lookalike-host hardening and updated docs. All three
workflows succeeded:

| Workflow | Run ID | Result | Evidence |
| --- | --- | --- | --- |
| Cloud Backend CI | `45510042756` | **success** | **74/74 tests**, typecheck, masked config/deployment checks, health smoke, container build. |
| Android CI | `45510042640` | **success** | Unit tests, backend core tests, lint, debug APK, package/secret checks, API 35 emulator smoke, and HTTPS integration covering image upload/list/analysis, generation, search and task create/update/cancel. |
| Publish backend image | `45510042718` | **success** | Backend image build/publish workflow completed. |

The debug APK artifact from Android run `45510042640` was downloaded and hashed locally:
**SHA-256 `58c32b837915ebb8c0eff6e9ac0d33d661543a50ffd4f7d9661efdaf720437a8`** (10,052,948 bytes).
It remains a debug artifact, not a signed release APK.

## Security audit summary

| Check | Status | Notes |
| --- | --- | --- |
| No secrets in source | PASS | New code uses env names only; no keys added. |
| No committed `.env` values | PASS | `deploy/.env.example` contains names only. |
| OAuth token encryption | PASS (controlled) | AES-256-GCM, tamper rejection. |
| Image validation | PASS | Magic bytes, size cap, sanitized filename, owner scope. |
| SSRF / fixed upstream hosts | PASS | Image generation and search hosts are fixed backend configuration. |
| Path traversal | PASS | File and image path validation; image bytes stay in SQLite. |
| Command injection | PASS | No shell execution of user input in new endpoints. |
| Payload limits | PASS | 1 MiB default JSON limit; larger only for image upload with a 5 MiB decoded cap. |
| Artifact grant expiry/single-use | PASS (controlled) | 10-minute hash-only grant; deleted after use. |
| Logs/errors | PASS | Safe error codes; provider bodies not echoed. |
| Dependency vulnerabilities | NOT RUN | No package-manager audit was available offline; no new npm dependency was added. |
| Rate limiting | NOT IMPLEMENTED | Existing backend has no per-IP throttle; document as follow-on hardening. |

## Outstanding external blockers

1. **Permanent HTTPS backend host and DNS domain** — required for real OAuth callbacks and live app use.
2. **GitHub OAuth App client ID/secret and browser consent** — required for live OAuth, repository
   connection, commits and Actions dispatch.
3. **`OPENROUTER_API_KEY`** — required for live image understanding and OpenRouter text fallback.
4. **Android signing secrets** (`ANDROID_KEYSTORE_BASE64`, password, alias, key password) — required
   for a real signed production APK.
5. **A successful real release workflow run** — required for signed APK evidence and browser download.
6. **A physical Android device with `adb`** — required for physical-device verification; the checker
   currently returns `adb_unavailable`.
7. **Optional hardening** — request rate limiting and a dependency audit in an environment with
   registry access.

## Production release completion

This section records verified milestones for the production-release stage. Each row is updated only
after the named evidence exists; blockers remain explicit.

| Milestone | Status | Evidence / blocker |
| --- | --- | --- |
| Dependency vulnerability audit | IMPLEMENTED (locally verified; CI confirmed) | Backend has zero npm dependencies; `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities on 2026-11-25. `scripts/audit-dependencies.mjs` queried OSV for 14 pinned Gradle coordinates: 0 findings after bumping `org.json:json` from `20240303` to `20260814` (GHSA-ghc9-756g-vrcv) and Kotlin plugin from `2.0.21` to `2.4.21` (GHSA-r937-wjx7-w2jp). GitHub vulnerability alerts enabled. CI: Dependency audit `45515748155` and Android CI `45517043317` succeeded on `79828dc`; dependency-graph workflow needed `build-root-directory: android` and must pass again after that fix. |
| API rate limiting and abuse protection | IMPLEMENTED (locally verified; CI pending) | Dependency-free fixed-window limiter added for auth, OAuth start, chat/search/image analysis, image generation/tasks and general API traffic; proxy headers honoured only with `TRUST_PROXY=1`; 429 + `Retry-After` and `X-RateLimit-*` headers. New unit/HTTP tests brought the local suite to **79 passed, 0 failed**. |
| GitHub OAuth and repository permission review | IMPLEMENTED (live **BLOCKED**) | Reviewed one-time hashed state, 10-minute expiry, token exchange/encryption/revocation, repo permission checks and per-user project scoping. Fixed a real gap: the callback now verifies that `public_repo` and `workflow` were granted, revokes and rejects reduced-scope tokens, and a regression test covers it. Local suite now **80 passed, 0 failed**. Live browser consent still requires an OAuth App and HTTPS deployment. |

## Next action to reach a production release

Provide the six external items above. Then run the documented sequence in `docs/DEPLOYMENT.md`:
deploy the container behind HTTPS, configure the OAuth callback, connect a repository, dispatch the
release workflow with signing secrets, verify the APK evidence endpoint, and install the signed APK on
a physical device. No further architectural phase is required for Phases 1–8; the remaining work is
credentialed deployment, live acceptance and device verification.
