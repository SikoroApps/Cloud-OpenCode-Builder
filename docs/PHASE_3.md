# Phase 3 — GitHub Integration & Cloud Android Builds

Phase 3 starts from Phase 2 HEAD `09c4d94`; no Phase 2 code was removed or rewritten. Work proceeds
one dependency-ready batch at a time as defined in `docs/BUILD_ORDER.md`.

## Batch 3.1 — GitHub authentication (IMPLEMENTED, LIVE BLOCKED)

### Implemented

- Backend OAuth start endpoint `GET /api/github/oauth/start`:
  - generates a 256-bit random state, stores only its SHA-256 hash with a 10-minute expiry;
  - returns an HTTPS GitHub authorize URL requesting least-privilege classic scopes
    `public_repo workflow` (public repositories only);
  - returns `503 github_not_configured` when no OAuth secrets are configured.
- Public callback endpoint `GET /api/github/oauth/callback`:
  - validates and consumes the one-time state;
  - exchanges the code server-side, fetches the GitHub identity, encrypts the access token with
    AES-256-GCM and stores only ciphertext in SQLite;
  - redirects to the Android app callback with `status=connected` or a safe error code, never with
    a token.
- `GET /api/github/status` reports configuration and connection state without token material.
- `DELETE /api/github` removes the local connection and best-effort revokes the token with GitHub.
- Android client methods for OAuth start/status/disconnect, all using the existing HTTPS-only
  transport.
- Tests: AES token round-trip/wrong-key rejection, OAuth URL safety, config validation, mocked
  exchange error safety, and full mocked connect/status/reuse/disconnect API flow.

### Verified locally

- `cd cloud && npm test`: **14 passed, 0 failures** (8 Phase 2 tests + 6 Phase 3.1 tests).
- No live GitHub OAuth was performed; no credentials were created or committed.

### Exact external setup needed for live verification

1. Create a **GitHub OAuth App** (not a GitHub App) in the SikoroApps account or an authorized org.
2. Set its Authorization callback URL to:
   `https://<CLOUD_BACKEND_DOMAIN>/api/github/oauth/callback`
3. Configure these backend secrets/environment variables (never in git or the Android app):
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `GITHUB_OAUTH_REDIRECT_URI` — the same HTTPS callback URL
   - `GITHUB_TOKEN_ENCRYPTION_KEY` — base64 of 32 random bytes, e.g. generated with
     `openssl rand -base64 32`
   - optional `GITHUB_APP_CALLBACK_URL` — defaults to `cloudopencode://github/callback`
4. Set the Android build's public `CLOUD_BASE_URL` to the HTTPS backend domain.
5. Authorize the app from a signed-in user account. Only then can live connect/disconnect be claimed.

No client ID, secret, token or encryption key is present in this repository.

### Remaining batches

Repository management, cloud file editing/commits, Actions orchestration, APK delivery and signed
release preparation are intentionally blocked until 3.1 is live-configured and its CI evidence is
recorded. They are listed in dependency order in `docs/BUILD_ORDER.md`.
