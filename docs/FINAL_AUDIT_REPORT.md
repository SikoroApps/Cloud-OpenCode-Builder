# Final 8-phase audit report

Date: 2026-11-25  
Final code checkpoint: `05b1a82609c5c026328ab8e4821a214a91ad91fb` (`main`)  
Repository: `SikoroApps/Cloud-OpenCode-Builder` (push remote `sikorokoro44/Cloud-OpenCode-Builder`)

Status vocabulary: **VERIFIED**, **IMPLEMENTED**, **BLOCKED**, **FAILED**, **NOT TESTED**.  
This report distinguishes code/test evidence from live production evidence. It does not treat a
green unit test as proof of a live external service.

## 1. Scope and final CI evidence

All workflows on the final code checkpoint are green:

| Workflow | Run | Result |
| --- | --- | --- |
| Android CI | [`45636326703`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45636326703), attempt 2 | **VERIFIED** — unit tests, lint, debug APK, API 35 emulator smoke, HTTPS backend integration |
| Cloud Backend CI | [`45636326609`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45636326609) | **VERIFIED** — 96 passed, 0 failed |
| Publish backend image | [`45636326618`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45636326618) | **VERIFIED** |
| Dependency audit | [`45636326512`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45636326512) | **VERIFIED** |
| Submit dependency graph | [`45636326557`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45636326557) | **VERIFIED** |
| Android signed release | [`45629726291`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45629726291) | **VERIFIED** — signed APK plus `apksigner` evidence |

Two Android CI attempts failed before the final green attempt and are recorded under §10.

## 2. Phase 1 — Foundation

**VERIFIED.** Android targets API 26+, Kotlin/Jetpack Compose, GitHub Actions builds, lint, JVM
unit tests, debug APK assembly and API 35 emulator smoke test are green in Android CI
`45636326703`. Local Gradle/Android SDK are unavailable in this environment, so all Android
build/test evidence comes from GitHub Actions, not from a local build.

## 3. Phase 2 — Cloud AI engine

**VERIFIED for implementation; live provider inference BLOCKED.**

- Free-model fallback order is unchanged: `opencode/big-pickle`,
  `opencode/deepseek-v4.1-flash-free`, `opencode/flint-40b-free`,
  `openrouter/baidu/ernie-5.5-flash-preview:free`,
  `openrouter/google/gemma-4-26b-a4b-it:free`.
- Fail-fast missing-key errors, attribution headers, injectable fetch, error mapping, per-attempt
  20-second timeout, bounded exponential backoff, and continuation after transport rejection are
  covered by `cloud/tests/ai.test.ts`.
- Historical real provider probes observed OpenCode `MODELTEST` success and OpenRouter `429`.
  Current live inference is **BLOCKED** because no `OPENCODE_API_KEY` / `OPENROUTER_API_KEY` is
  configured in this environment.

## 4. Phase 3 — GitHub integration

**IMPLEMENTED; live OAuth consent BLOCKED.**

- OAuth state is one-time, hashed and expiring; tokens are exchanged server-side, encrypted with
  AES-256-GCM and never returned to Android.
- Repository listing, owner-scoped files, protected-path rejection, commits, Actions runs/jobs,
  artifact listing and artifact checksums are covered by tests.
- The Android app declares `cloudopencode://github/callback`, handles `onCreate`/`onNewIntent`,
  refreshes GitHub status after callback, and maps denial/scope/state errors.
- Live consent is **BLOCKED** on a real OAuth App, HTTPS callback domain, deployed backend and
  browser interaction.

## 5. Phase 4 — Live integration and release verification

**IMPLEMENTED; release pipeline VERIFIED; live OAuth still BLOCKED.**

HTTPS integration in Android CI exercises health, auth, chat, files, tasks, images, web search and
APK delivery against the temporary backend. The signed release pipeline is no longer only a
template: it ran successfully and produced signature evidence (§13). Live OAuth consent remains
external.

## 6. Phase 5 — Deployment and first real APK

**VERIFIED for debug APK delivery; production deployment BLOCKED.**

- Backend container image publishes successfully (`45636326618`).
- Caddy/Compose deployment shape and deployment checker exist.
- Debug APK delivery was live-verified end-to-end (§12).
- A permanent public HTTPS backend URL is **BLOCKED**; the signed APK was built with the placeholder
  `https://cloud-opencode-backend.example` input.

## 7. Phase 6 — Image uploads and understanding

**IMPLEMENTED; storage VERIFIED; live vision BLOCKED.**

Owner-scoped upload, magic-byte validation, 5 MiB cap, sanitized filenames, authenticated retrieval,
`X-Content-Type-Options: nosniff`, and restart persistence are tested. Live vision analysis is
**BLOCKED** on `OPENROUTER_API_KEY`; only controlled tests verify that path.

## 8. Phase 7 — Image generation

**VERIFIED.** Free keyless Pollinations integration with fixed-host SSRF protection, prompt/size
limits and storage through the Phase 6 pipeline. A real 512px JPEG was generated, persisted,
re-read after backend restart and matched SHA-256
`62ac8e0945cea1df95145fd773e2e7a2163e9ce1919112974af52289c20f9169`.

## 9. Phase 8 — Web search and persistent cloud tasks

**VERIFIED.** Live DuckDuckGo search returned real results; search-grounded chat with citations and
SQLite-backed tasks survived a real backend restart. See `docs/PHASE_8.md`.

## 10. Discovered errors and fixes

All items below were fixed in code/workflow and re-tested; none was resolved by weakening or
skipping a test.

| Area | Discovered error | Fix / evidence |
| --- | --- | --- |
| AI fallback | Rejected provider promise aborted the whole chain; no timeout/backoff | Continues on transport rejection; 20s timeout; bounded backoff; `tests/ai.test.ts` |
| APK grants | Non-atomic grant consumption allowed replay races | Single `DELETE ... RETURNING`; `tests/grants.test.ts` |
| Builds | Dispatch before DB record; `runs[0]` selected wrong run; partial commits | Record first, oldest matching run after record, rollback on failure |
| Auth OAuth | Callback bypassed rate limit; callback scheme unvalidated | Dedicated callback rate limit; `cloudopencode://` validation |
| API | `auth/me` null race; `logout` 204 had body; unvalidated `sessionKey`; server double-end | Null guard, empty 204, sessionKey validation, end-once guard |
| GitHub | Missing request timeouts; artifact size trusted from `content-length` | 30s timeouts; precheck plus bounded streamed-body cap (`readBoundedResponseBytes`) |
| Android UI | Missing theme resource; retry lambda type/syntax errors | Platform theme; `retry = { ... }` named argument; green Android CI |
| Android UX | No onboarding/dashboard/tabs/session switching/settings/model status; false-success buttons | `CloudOpenCodeScreens.kt` and `CloudOpenCodeViewModel.kt` rewritten; retry/error/loading states |
| Android security | Host allowlist ignored; HTTP APK links accepted; expired artifacts shown | Allowlist enforced; HTTPS-only links; expired artifacts filtered |
| Scaffold | Plain `invalid_app_name` throw produced wrong API status | Mapped to `ApiRequestError(400, "invalid_request")` |
| Signed release | `android.injected.signing.store.type=keystore` caused `KeytoolException: keystore not found` | Use `jks` and absolute `ANDROID_KEYSTORE_PATH`; run `45629726291` green |
| CI tunnel | `grep` treated binary cloudflared log as binary and found no URL | `grep -aoE` in `android-ci.yml` |
| CI tunnel | Cloudflare quick-tunnel provisioning returned HTTP 429 | Retried after cooldown; attempt 2 of `45636326703` green |

Failed CI attempts retained for transparency:

- `45634661611`: **FAILED** — binary tunnel log grep.
- `45636326703` attempt 1: **FAILED** — Cloudflare quick tunnel `429`.
- `45636326703` attempt 2: **VERIFIED**.

## 11. Android and backend test results

- Backend: **96 passed, 0 failed** locally and in Cloud Backend CI `45636326609`.
- Android CI `45636326703`: JVM unit tests, lint, debug APK assembly, API 35 emulator smoke test,
  and HTTPS backend integration all passed.
- Pure JVM helpers tested locally/CI: `ApkDelivery`, `GithubOAuthResult`, `UserFacingErrors`,
  `CloudApiClientSecureUrlTest`, `BuildConfigurationTest`.
- No local Android build was possible (no Gradle/Android SDK); this is an environment limitation,
  not a skipped CI gate.

## 12. APK delivery — VERIFIED (debug)

Live verification used `cloud/scripts/verify-apk-delivery.mjs` against Android CI run
[`45622989945`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45622989945)
(code checkpoint `73d4289`; no later source change touched this path).

- Artifact: [`15027061074`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45622989945/artifacts/15027061074), `cloud-opencode-debug`, `app-debug.apk`
- Size: **10,333,811 bytes**
- SHA-256: `6b65de0f61e50e30a342cb006e0f76232402a9d587d3e56af0b26abcfebccc71`
- Link grant: 10-minute, single-use, hash-only; download required **no `Authorization` header**
- Replayed grant: `403`; unauthenticated request without grant: `401`
- `Content-Type: application/vnd.android.package-archive`; checksum endpoint matched header and file
- **20/20** end-to-end checks passed
- Earlier independent verification on `b06911a`: artifact `15015027414`, 10,251,891 bytes,
  SHA-256 `c0c9322b810ced52b98b813a427aec8b011ed013f9c133aed2ecf1e0228c69ae`

This proves browser APK delivery for a **debug** artifact only.

## 13. Signed release APK — VERIFIED pipeline, production BLOCKED

Signed release run [`45629726291`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45629726291)
succeeded using a self-signed release keystore stored only in GitHub Actions secrets.

- Signed APK: [`15030222172`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45629726291/artifacts/15030222172), `app-release.apk`, **1,567,651 bytes**
- SHA-256: `4b6bab61cb87e86aa64e53504a9166d558b3c3e31037203a95ed61414c7b52e4`
- Evidence artifact: [`15030735426`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45629726291/artifacts/15030735426)
- `apksigner verify --verbose --print-certs`: **Verified**; APK Signature Scheme v2 verified;
  RSA 4096; signer `CN=Cloud OpenCode, OU=Release, O=SikoroApps, L=Internet, ST=Internet, C=US`;
  certificate SHA-256 digest `374985d10e1c1c126bf39965782ba59b98a0a35f4b4c43e3b27013428185788e`
- `aapt dump badging`: `com.sikorokoro44.cloudopencode`, versionCode 1, versionName 0.1.0,
  minSdk 26, targetSdk 35, launchable `MainActivity`

The certificate is **self-signed** and the baked backend URL is a placeholder, so this is release
pipeline/signature verification, **not** a production release.

## 14. Security audit

**IMPLEMENTED with documented limitations.**

- No API keys, passwords, tokens, keystores, `.jks` material or signing credentials were committed.
  Signing material was created in `/data/data/com.termux/files/usr/tmp`, written to GitHub Actions
  secrets, and never added to the repository.
- `gh auth token` was used only in memory by the delivery verifier.
- Owner-scoped project/image/task/build data; protected file paths; magic-byte image validation;
  HTTPS-only cloud URLs with host allowlist; encrypted tokens; one-time OAuth state; separate
  OAuth callback rate limit; atomic download grants; bounded artifact reads; CI secret-marker scan.
- Limitations: the self-signed certificate is not a production signing identity; the rate limiter is
  per process; PKCE is not implemented; backend APK verification consumes CI evidence text rather
  than performing cryptographic APK signature validation itself.

## 15. Blockers, physical-device-only features, and remaining gaps

| Item | Status | Notes |
| --- | --- | --- |
| Live GitHub OAuth consent | **BLOCKED** | Needs real OAuth App, HTTPS callback domain, deployed backend, browser interaction |
| Live OpenRouter/OpenCode inference | **BLOCKED** | No provider API keys configured; fallback logic is code-tested only |
| Permanent public HTTPS backend | **BLOCKED** | No deployed public URL; signed APK used a placeholder URL |
| Production signed APK | **BLOCKED** | Pipeline and self-signed APK are VERIFIED; production key/domain absent |
| Physical-device install/launch | **NOT TESTED** | No `adb` or connected device; API 35 emulator smoke is not physical-device proof |
| On-device deep-link callback, APK open intent, hardware/UI flows | **NOT TESTED** | Require a physical device |
| Streaming chat responses | **NOT TESTED** (not implemented) | Current chat API is request/response |
| Long-conversation summarization/token budgeting | **NOT TESTED** (not implemented) | History is capped at 200 messages |
| Backend-managed conversation CRUD/list | **NOT TESTED** (not implemented) | Android persists a `sessionKey`; no server-side conversation list API |
| Build cancel endpoint | **NOT TESTED** (not implemented) | Task cancellation exists; workflow-run cancellation does not |
| Raw GitHub log text | **NOT TESTED** (not implemented) | `/api/projects/build/logs` returns jobs/steps and failed steps, not full log bytes |
| Cryptographic APK verification in backend | **NOT TESTED** (not implemented) | Evidence-artifact verification is implemented, not signature cryptography |
| PKCE | **NOT TESTED** (not implemented) | Not added to the current GitHub OAuth App flow |
| Generated scaffold project built in GitHub Actions | **NOT TESTED** | Endpoint saves a buildable project template with workflow/tests; no live scaffold build was triggered |

## Commit chain

`9770d88` → `0a9b02a` → `3c084b7` → `240b285` → `b06911a` → `3b3301a` → `b2770ed` →
`da463cd` → `6a04e80` → `73d4289` → `46b6adc` → `87f8424` → `39fdfab` → `d1275d6` →
`d74fb22` → `05b1a82`.

Conclusions: all eight phase areas have automated verification; debug APK delivery, image
generation, web search, task persistence and the signed release pipeline have live/artifact-level
verification. Live OAuth, live provider inference, permanent HTTPS deployment, production signing,
and physical-device behavior remain explicitly blocked or untested.
