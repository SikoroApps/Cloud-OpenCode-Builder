# Phase 9 — Production readiness

Date: 2026-11-25  
Repository: `SikoroApps/Cloud-OpenCode-Builder`  
Final Phase 9 code checkpoint: `5a0def3` (`main`)  
Previous audited checkpoint: `ef6b6b6` (Phases 1–8)

Status vocabulary: **VERIFIED**, **IMPLEMENTED**, **BLOCKED**, **FAILED**, **NOT TESTED**.
A masked configuration check is never presented as proof of a live external service.

## 1. Requirements and preservation

| Requirement | Status | Evidence |
| --- | --- | --- |
| Inspect repo/branch/tree/latest audit before changes | **VERIFIED** | `main`, clean tree at `ef6b6b6`; `docs/FINAL_AUDIT_REPORT.md` reviewed before implementation. |
| Preserve Phases 1–8 | **VERIFIED** | No Phase 1–8 source feature was removed; Android CI still builds/tests/lints the app and backend. |
| Preserve five-model fallback order exactly | **VERIFIED** | Regression test asserts the exact order in `cloud/tests/phase9-tools.test.ts`; order is unchanged: `opencode/big-pickle`, `opencode/deepseek-v4.1-flash-free`, `opencode/flint-40b-free`, `openrouter/baidu/ernie-5.5-flash-preview:free`, `openrouter/google/gemma-4-26b-a4b-it:free`. |
| Never commit credentials/secrets | **VERIFIED** | Only environment names, GitHub Actions secret references and presence booleans were added. No key, token, password, `.env`, keystore or `.jks` was committed. |
| Use GitHub Actions and GitHub Secrets appropriately | **IMPLEMENTED** | New manual workflows use secret references; production CI runs masked checks on every push. |
| Do not replace working features with placeholders | **VERIFIED** | Existing AI, GitHub, build, artifact, image and task implementations remain in place. |
| Do not claim external services without testing | **VERIFIED** | Live AI and OAuth remain explicitly **BLOCKED**; live workflow output says `BLOCKED`. |
| Run tests after each batch | **VERIFIED** | 98/98 → 105/105 → 111/111 → 118/118, each with 0 failures. |
| Report exact commits, run IDs, tests and blockers | **VERIFIED** | This document and the CI tables below. |
| No unearned physical-device claim | **VERIFIED** | No `adb` device was connected; physical-device work remains **NOT TESTED**. |

## 2. Implementation batches and commits

| Batch | Commit | What changed | Tests |
| --- | --- | --- | --- |
| 1 — deployment/OAuth preflight | `10c7e0d` | Readiness now checks OAuth redirect host and mobile callback scheme; deployment preflight checks rate limiting and proxy trust. | **98 passed, 0 failed** (CI `45649561357`) |
| 2 — secret-safe tooling | `9974d00` | Added key generator, live-AI verifier, deploy-file checker, `production-readiness.yml`, `live-ai-verification.yml`, and fallback-order regression test. | **105 passed, 0 failed** (CI `45650183650`) |
| 3 — fail-fast configuration | `86d4c91` | Added `validateCloudConfig`; server refuses unsafe production config; OAuth callback path, HTTPS backend, rate limits and trusted proxy are enforced by code. | **111 passed, 0 failed** (CI `45651785027`) |
| 4 — release readiness gate | `5a0def3` | Added masked release-readiness evaluator/script and manual `release-readiness.yml` workflow. | **118 passed, 0 failed** (CI `45652195102`) |

## 3. Production backend deployment/configuration — IMPLEMENTED, live deployment BLOCKED

Implemented and verified in code/CI:

- `deploy/docker-compose.yml` binds the backend to `127.0.0.1:8080`, persists SQLite in `backend-data:/data`, and makes Caddy wait for a healthy backend.
- `deploy/Caddyfile` terminates HTTPS for `{$CLOUD_DOMAIN}`, sets HSTS, `nosniff`, `no-referrer` and `DENY` frame options, then reverse-proxies to the backend.
- `deploy/.env.example` documents every required name, including `DEPLOYMENT_HEALTH_URL`, without values.
- `cloud/scripts/check-deploy-files.mjs` structurally verifies this runtime shape.
- `cloud/scripts/check-config.mjs` and `cloud/scripts/check-deployment.mjs` print only presence booleans, blocker codes and HTTP status.
- `cloud/src/config-validation.ts` fails fast on unsafe production settings and returns stable error codes without URLs or values.
- `cloud/Dockerfile` still runs as non-root with `/data` persistence and `/health` healthcheck.

**BLOCKED:** no public host, DNS domain or deployed backend environment exists in this workspace. Therefore this is a deployable configuration, not a claim of a live deployment.

## 4. Live AI integration — IMPLEMENTED, live inference BLOCKED

- `cloud/scripts/verify-ai.mjs` sends a real request through the unchanged fallback chain when a provider key is present, and reports only model/finish-reason metadata.
- With no keys, it returns `BLOCKED` and `no AI provider key is configured`; `--require-live` exits non-zero.
- Live workflow [`45653061448`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45653061448) completed **success** with status `BLOCKED`, proving the workflow honestly reports the missing provider keys instead of inventing success.
- No `OPENCODE_API_KEY` or `OPENROUTER_API_KEY` is configured in repository secrets here.

**BLOCKED:** real provider inference requires at least one key in the backend secret store (or the named GitHub Actions secrets for the manual verifier).

## 5. GitHub OAuth — IMPLEMENTED, live consent BLOCKED

- Readiness now rejects a callback host that differs from `CLOUD_BASE_URL`, a callback path other than `/api/github/oauth/callback`, and a mobile callback scheme other than `cloudopencode:`.
- Runtime config validation applies the same rules and refuses to start an unsafe production backend.
- Existing OAuth controls remain: one-time hashed state, 10-minute expiry, server-side exchange, scope verification for `public_repo` and `workflow`, AES-256-GCM encrypted tokens, callback rate limiting and token revocation on insufficient scope.
- `docs/GITHUB_OAUTH_SETUP.md` remains the manual consent runbook.

**BLOCKED:** no GitHub OAuth App, HTTPS callback domain or browser authorization was available. Configuration validity is not proof of live OAuth.

## 6. Secure secrets — VERIFIED for repository content, external secret store BLOCKED

- `cloud/scripts/generate-encryption-key.mjs` prints one 32-byte base64 key to stdout once and warns on stderr to store it only in a secret manager.
- The release gate uses `gh secret list`, which exposes names only, and never prints values.
- GitHub Actions workflows reference credentials as `${{ secrets.NAME }}`; tests assert no literal secret markers appear in workflow files.
- No credentials, tokens, passwords, `.env` values, keystores or `.jks` material were committed in Phase 9.
- Existing Android signing secrets remain only as four GitHub Actions secrets.

**BLOCKED:** production OAuth/provider keys are absent, and `RELEASE_READINESS_TOKEN` (optional token with permission to list target-repo secret names) is not configured.

## 7. Release readiness — IMPLEMENTED, live release BLOCKED

- `cloud/src/release-readiness.ts` evaluates four masked checks: signing secret names, HTTPS backend URL, health status 200, and at least one provider key name.
- `cloud/scripts/check-release-readiness.mjs` prints status, booleans, blocker codes and provider key **names** only.
- Manual workflow [`45653254004`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45653254004) completed **success** with status `BLOCKED`. Blockers were: `gh_secret_list_failed_for_target_repository`, `CLOUD_BASE_URL must be an HTTPS URL`, and `no AI provider key is configured for live release verification`. The first blocker reflects the built-in Actions token lacking secret-list permission; adding the optional `RELEASE_READINESS_TOKEN` secret is required for a complete gate.
- Local run against `SikoroApps/Cloud-OpenCode-Builder` found all four signing secret names present, but backend URL and provider keys absent, so status was `BLOCKED`.

**BLOCKED:** real production signing identity, deployed HTTPS backend, provider keys, and live signed-APK delivery against that backend.

## 8. CI evidence for final checkpoint `5a0def3`

| Workflow | Run | Result |
| --- | --- | --- |
| Cloud Backend CI | [`45652195102`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652195102) | **VERIFIED** — 118 passed, 0 failed; masked config/deployment checks; health smoke; container build. |
| Android CI | [`45652195081`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652195081) | **VERIFIED** — unit tests, backend tests, lint, debug APK, package/secret checks, API 35 emulator smoke, HTTPS integration. |
| Production readiness | [`45652195282`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652195282) | **VERIFIED** — tests plus masked config, deployment and deploy-file checks. |
| Dependency audit | [`45652195100`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652195100) | **VERIFIED** |
| Publish backend image | [`45652194998`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652194998) | **VERIFIED** |
| Submit dependency graph | [`45652195047`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45652195047), attempt 2 | **VERIFIED** after rerun. |
| Live AI verification (manual) | [`45653061448`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45653061448) | **BLOCKED** honestly — no provider keys. |
| Release readiness (manual) | [`45653254004`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45653254004) | **BLOCKED** honestly — no backend URL/provider keys and no secret-list token. |

Earlier dependency-submission attempts `45649561354`, `45650183821`, `45651784661`, and `45652195047` attempt 1 are retained as **FAILED**. The generated snapshot was byte-equivalent to the earlier successful snapshot apart from job SHA/timestamp, and the API/rerun endpoints returned HTTP 500/502. Attempt 2 of the final run succeeded; no failure was masked.

One Android CI run on intermediate commit `86d4c91`, [`45651784935`](https://github.com/SikoroApps/Cloud-OpenCode-Builder/actions/runs/45651784935), was **cancelled** because a newer push superseded its concurrency group. The final Android CI run above is green.

## 9. Remaining blockers / NOT TESTED

| Item | Status | Reason |
| --- | --- | --- |
| Permanent public HTTPS backend | **BLOCKED** | No host/DNS/deployed environment. |
| Live GitHub OAuth consent | **BLOCKED** | No OAuth App, HTTPS callback or browser authorization. |
| Live provider inference | **BLOCKED** | No provider API keys. |
| Live vision / live signed-APK delivery | **BLOCKED** | Depends on provider keys and deployed backend. |
| Production signing identity | **BLOCKED** | Existing release was self-signed with placeholder backend URL. |
| Physical-device install/launch/deep link | **NOT TESTED** | No `adb` or connected device. |
| Full release gate with secret names | **BLOCKED** | `RELEASE_READINESS_TOKEN` not configured; built-in token cannot list target-repo secrets. |

## 10. Safe operator commands

```sh
cd cloud
npm test
npm run typecheck
npm run check:config
npm run check:deployment
npm run check:deploy-files
npm run generate:key          # store output only in a secret manager
npm run verify:ai             # BLOCKED until a provider key exists
APP_REPO=<owner>/<app-repo> npm run check:release
```

For a live deployment, set values only in the backend host secret store, then run the runbook in
[`DEPLOYMENT.md`](DEPLOYMENT.md) and [`GITHUB_OAUTH_SETUP.md`](GITHUB_OAUTH_SETUP.md). Do not paste
secret values into chat, issues, screenshots, source files or CI logs.
