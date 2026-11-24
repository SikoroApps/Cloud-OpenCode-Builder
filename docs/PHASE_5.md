# Phase 5 — Live Integration and First Real APK

Phase 5 starts from Phase 4 checkpoint `d136bdaacb0c9b35421f8edbfe913a8afaee0d1a`. It preserves all
Phase 2–4 implementations and follows the dependency order below. No live-service, signed-APK or
physical-device claim is made unless actual evidence is recorded here.

## Batch status

| Batch | Scope | Status |
| --- | --- | --- |
| 5.1 | Deployment readiness | IN PROGRESS |
| 5.2 | GitHub OAuth | IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED |
| 5.3 | GitHub repository connection | NOT STARTED |
| 5.4 | Real GitHub Actions orchestration | NOT STARTED |
| 5.5 | Signed APK delivery | NOT STARTED |
| 5.6 | Real-device verification | NOT STARTED |

## Batch 5.1 — Deployment readiness

### Supported deployment target

The backend is a containerized Node.js 22 service:

- `cloud/Dockerfile` builds a non-root image that binds `0.0.0.0:8080`.
- `GET /health` is the health endpoint and is used by the Docker `HEALTHCHECK`.
- SQLite state is stored at `/data/cloud-opencode-backend.sqlite`; `/data` must be a persistent volume.
- TLS is terminated by the hosting platform or a reverse proxy. The Android client refuses any
  backend URL that is not HTTPS.
- Configuration is environment-only; no key, token or password is present in source or images.

See `docs/DEPLOYMENT.md` for the exact deployment contract and safe verification commands.

### Implemented

- `cloud/src/deployment.ts` evaluates deployment readiness from booleans and status codes only.
- `cloud/scripts/check-deployment.mjs` prints masked checks and blocker codes; `--require-live`
  makes it exit non-zero when live prerequisites are missing.
- `npm run check:deployment` is available in `cloud/package.json`.
- Cloud Backend CI runs the masked checker without requiring live credentials.

### Verification

- `cd cloud && npm test`: **40 passed, 0 failures** (38 prior + 2 new deployment-readiness tests).
- `cd cloud && npm run typecheck`: passed.
- `cd cloud && npm run check:config`: passed; only booleans, blocker codes, manual checks and secret names printed.
- `cd cloud && npm run check:deployment`: passed; `readyForDeployment: false` with blockers for
  non-HTTPS base URL, unconfigured OAuth, missing AI key and missing HTTPS health URL.
- `git diff --check`: passed.

### Blocked

Permanent hosting, an HTTPS domain and provider secrets are external dependencies. They are not
invented. The checker reports them as blockers without printing values.

## Batch 5.2 — GitHub OAuth

### Implemented and verified

- Existing server-side OAuth start/callback/status/disconnect flow is preserved. Tokens are exchanged
  server-side, encrypted with AES-256-GCM and never returned to Android, logged or committed.
- Added controlled tests in `cloud/tests/phase5-oauth.test.ts` proving:
  - OAuth state is single-use and replayed callbacks are rejected;
  - expired state is rejected before token exchange;
  - denied and malformed callbacks redirect with safe error codes;
  - unconfigured OAuth returns `github_not_configured` without creating credentials.
- `cd cloud && npm test`: **44 passed, 0 failures** (40 prior + 4 new OAuth tests).
- `cd cloud && npm run typecheck`: passed.
- Setup instructions are in `docs/GITHUB_OAUTH_SETUP.md`; no CLI token is substituted for consent.

### Blocked

No GitHub OAuth App, HTTPS callback domain, client ID/secret or encryption key is configured in this
environment, and no browser authorization can be performed by this harness. `connected: true` has
not been observed against a live backend, so live OAuth is **not** verified.

## Batch 5.3 — GitHub repository connection

Not started.

## Batch 5.4 — Real GitHub Actions orchestration

Not started.

## Batch 5.5 — Signed APK delivery

Not started.

## Batch 5.6 — Real-device verification

Not started.
