# Phase 4 — Live Integration and Release Verification

Phase 4 starts from Phase 3 HEAD `54e2d49`. All Phase 2 and Phase 3 implementations are preserved.
This document records only verified evidence. No live GitHub, signed APK or real-device claim is
made.

For the beginner-friendly manual procedure to unblock Batch 4.2, see
`docs/GITHUB_OAUTH_SETUP.md`. It covers OAuth App creation, the exact callback URL, secret
placement, key generation and safe verification commands.

## Batch 4.1 — External configuration readiness (IMPLEMENTED, BLOCKED ON EXTERNAL VALUES)

### Implemented

- `cloud/src/readiness.ts` builds a masked configuration summary from presence/format checks only.
  It never copies a client ID, client secret, redirect URI, token, encryption key or AI key into its
  output.
- `GET /api/config/readiness` returns the same summary to an authenticated caller.
- `npm run check:config` prints the summary from local environment variables without values.
- Cloud Backend CI runs the masked checker on every push.
- Required GitHub Actions secret names are reported explicitly but their values are never read or
  logged by the backend.

### Verified locally

- `cd cloud && npm test`: **38 passed, 0 failures** after the Batch 4.2–4.5 hardening work below.
- `cd cloud && npm run typecheck`: passed.
- `cd cloud && npm run check:config`: passed and printed only booleans, blocker codes, manual checks
  and secret names.
- New tests prove readiness output does not contain marker client IDs/secrets, configured callback
  URLs, tokens or AI keys.
- CI on commit `7c92adb`: `Cloud Backend CI` `45365548356` **success** (including the masked
  readiness step) and `Android CI` `45365548349` **success** (all jobs, including HTTPS integration).

### Configuration audit result

The following values are **UNSET** in the current environment (lengths/presence only were checked;
no values were printed):

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI`
- `GITHUB_TOKEN_ENCRYPTION_KEY`
- `CLOUD_BASE_URL`
- `OPENROUTER_API_KEY`
- `OPENCODE_API_KEY`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

`gh auth status` reports an authenticated GitHub CLI account with `repo` and `workflow` scopes, but
that CLI token is **not** the application's OAuth credential. It was not used to fake user consent,
stored in the backend, or printed. `gh secret list --org SikoroApps` returned HTTP 403 because the
current account is not an org admin; org-level secret values could not be inspected. No secrets are
configured in the `SikoroApps/Cloud-OpenCode-Builder` repository secrets list.

### Exact manual setup required

1. Create a GitHub OAuth App in the SikoroApps account or an authorized organization.
2. Set its Authorization callback URL to the deployed HTTPS backend callback:
   `https://<CLOUD_BACKEND_DOMAIN>/api/github/oauth/callback`.
3. Set backend environment/secrets:
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI`,
   `GITHUB_TOKEN_ENCRYPTION_KEY` (base64 of 32 random bytes).
4. Set `CLOUD_BASE_URL` to the same deployed HTTPS backend domain.
5. Configure at least one AI provider key (`OPENCODE_API_KEY` or `OPENROUTER_API_KEY`) for live AI
   file planning.
6. In the selected app repository, add protected Actions secrets:
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD`.
7. Authorize the OAuth App in a browser from a signed-in GitHub user account.
8. Connect a physical Android device with USB debugging enabled for installation/launch proof.

Steps 1–7 are explained in detail, with safe verification commands, in
`docs/GITHUB_OAUTH_SETUP.md`.

## Batch 4.2 — Live GitHub OAuth (IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED)

- Follow `docs/GITHUB_OAUTH_SETUP.md` for the exact manual setup and safe verification procedure.
- Existing start/callback/status/disconnect endpoints were preserved.
- New tests prove AES-256-GCM encrypted storage, authenticated decryption, tamper rejection, one-time
  state handling and absence of token material from status, repository and redirect responses.
- No live OAuth App exists and no browser authorization was performed. No real token was stored.
- `connected: true` has not been observed against a live backend, so OAuth is **not** live-verified.

## Batch 4.3 — Live AI file editing and commits (IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED)

- Added defensive enforcement for both manual and AI-generated file edits:
  - protected paths: `.env*`, `.github/*`, Gradle properties, keystore properties, keystores,
    certificates and Firebase service-account JSON;
  - secret-bearing content: GitHub token patterns and private-key blocks are rejected before a file
    can be saved or committed.
- Mocked tests confirm unsafe AI plans are rejected and no unauthorized file is written.
- No actual repository was connected or modified, no live AI provider was called, and no real commit
  was made.

## Batch 4.4 — Real GitHub Actions orchestration (IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED)

- Dispatch, run-id capture, status refresh, job conclusion and failed-step retrieval are preserved.
- Generated build and release workflows now install Android build tools and emit signature/checksum
  evidence through `apksigner`, `aapt` and `sha256sum` on GitHub-hosted runners.
- Mocked tests still require an actual `success` workflow conclusion before artifacts are exposed;
  dispatch-only HTTP 200 responses are never treated as successful builds.
- No live workflow was dispatched by the application and no real run ID or log was retrieved.

## Batch 4.5 — APK delivery and installation (IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED)

- Added `GET /api/projects/build/artifact/checksum` and an `X-APK-Sha256` response header on APK
  downloads. The checksum is computed from the APK bytes extracted from the GitHub Actions artifact.
- The signed-release workflow template now verifies the APK signature with `apksigner`, prints package
  metadata with `aapt`, writes a SHA-256 checksum and uploads an evidence artifact. Secret values are
  never printed; only protected Actions secret names are referenced.
- Android client gained `apkChecksum` and the HTTPS integration check covers its unconfigured error.
- No live artifact was downloaded, no APK signature was verified on a real APK, and no device
  install/launch was attempted.

## Batch 4.6 — Final release (BLOCKED)

A production-ready release cannot be claimed until the live OAuth, real repository commit, real
Actions conclusion, real signed APK signature and real-device gates above pass with actual evidence.
The independent implementation and automated-test gates are complete, but the release gate remains
closed.

## Status classification

- **Implemented**: Batch 4.1 readiness tooling; OAuth/file/build/APK hardening in Batches 4.2–4.5.
- **Automated-test verified**: 38 backend tests, masked checker and CI workflows.
- **Live-service verified**: none in Phase 4; GitHub CLI authentication only confirms CLI access,
  not application OAuth.
- **APK verified**: none; no real APK artifact or signature report was available in this environment.
- **Real-device verified**: none; no physical device or Android SDK is available here.
- **Blocked**: live portions of Batches 4.2–4.6 pending the manual setup listed above.
