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

- `cd cloud && npm test`: **33 passed, 0 failures** (8 Phase 2 + 25 Phase 3/4 tests).
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

## Batch 4.2 — Live GitHub OAuth (BLOCKED)

- Follow `docs/GITHUB_OAUTH_SETUP.md` for the exact manual setup and safe verification procedure.
- Implemented endpoints already exist from Batch 3.1, but live start/callback/status/disconnect was
  not run because no OAuth App or browser authorization exists.
- Secure token storage is covered by automated tests only; no real token was stored by the backend.
- No token appeared in API responses, logs or URLs because no live OAuth flow was performed.

## Batch 4.3 — Live AI file editing and commits (BLOCKED BY 4.2)

- No actual repository was connected through the app.
- No AI file plan was generated against a live provider.
- No real commit was made through the implemented API.

## Batch 4.4 — Real GitHub Actions orchestration (BLOCKED BY 4.3)

- No live workflow was dispatched by the application.
- No real workflow-run ID, job conclusion or log was retrieved in Phase 4.
- No success was inferred from HTTP 200 or dispatch-only responses.

## Batch 4.5 — APK delivery and installation (BLOCKED BY 4.4)

- No live artifact was retrieved.
- No APK package name, version, architecture, compatibility or signature was verified.
- No real-device install/launch was attempted; no device is available to this environment.

## Batch 4.6 — Final release (BLOCKED)

A production-ready release cannot be claimed until the live OAuth, real repository commit, real
Actions conclusion, APK signature and real-device gates above are completed with actual evidence.

## Status classification

- **Implemented**: Batch 4.1 readiness checker, endpoint, CI step and tests.
- **Automated-test verified**: 33 backend tests, masked checker and existing Phase 2/3 CI.
- **Live-service verified**: none in Phase 4; GitHub CLI authentication only confirms CLI access,
  not application OAuth.
- **Real-device verified**: none; no physical device or Android SDK is available here.
- **Blocked**: Batches 4.2–4.6 pending the manual setup listed above.
