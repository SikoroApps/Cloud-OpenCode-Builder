# Phase 5 — Live Integration and First Real APK

Phase 5 starts from Phase 4 checkpoint `d136bdaacb0c9b35421f8edbfe913a8afaee0d1a`. It preserves all
Phase 2–4 implementations and follows the dependency order below. No live-service, signed-APK or
physical-device claim is made unless actual evidence is recorded here.

## Batch status

| Batch | Scope | Status |
| --- | --- | --- |
| 5.1 | Deployment readiness | IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED |
| 5.2 | GitHub OAuth | IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED |
| 5.3 | GitHub repository connection | IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED |
| 5.4 | Real GitHub Actions orchestration | IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED |
| 5.5 | Signed APK delivery | IMPLEMENTED/AUTOMATED TESTS; LIVE BLOCKED |
| 5.6 | Real-device verification | TOOLING IMPLEMENTED; PHYSICAL DEVICE BLOCKED |

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

### Additional safe deployment artifacts

- `.github/workflows/publish-backend-image.yml` publishes a deployable image to GHCR on `main` using
  only the built-in `GITHUB_TOKEN`; no external credential is required. Image tags: `:latest` and
  `:sha-<commit>`. Verified **success** on commit `7c77c06` (run `45453671505`) after normalizing the
  owner to lowercase; image name is `ghcr.io/sikoroapps/cloud-opencode-backend`.
- `deploy/docker-compose.yml`, `deploy/Caddyfile` and `deploy/.env.example` provide a single-host
  HTTPS deployment shape with a persistent SQLite volume and a loopback-only backend port.
- `docs/DEPLOYMENT.md` records the exact five-step host setup. These artifacts are not a live
  deployment claim.
- Anonymous GHCR manifest access returned HTTP 401 for the package, but a control probe against a
  known public GHCR package returned HTTP 403 from this environment, so anonymous pull is
  **inconclusive**, not proven private. The current CLI token lacks `read:packages`. Exact
  requirement: confirm/set package visibility to public in GitHub Packages settings, or pull on the
  host with a token that has `read:packages`.

### Blocked

Permanent hosting, an HTTPS domain and provider secrets are external dependencies. They are not
invented. The checker reports them as blockers without printing values. A host with Docker Compose,
a public DNS domain and a filled `deploy/.env` are the exact missing requirements for Batch 5.1.

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

### Implemented

- `GithubService.getRepository` reads an authenticated repository and maps its permission object.
- `POST /api/github/repositories/connect` connects an existing accessible repository, requires
  write permission (`admin`, `maintain` or `push`) and selects it for subsequent project work.
- `GET /api/github/permissions` reports only booleans and the already-stored OAuth scope string:
  repository permissions, `canWrite`, `workflowScope` and `verified`. No token is returned.
- Existing create-public-repository and selection endpoints are preserved.

### Verified

- `cd cloud && npm test`: **47 passed, 0 failures** (44 prior + 3 new repository tests).
- Tests cover successful connect/selection, permission verification, read-only rejection and a safe
  `repository_not_found` provider code; no token material appears in responses.

### Blocked

No live GitHub OAuth connection exists in this environment, so no real repository was connected and
no real permission was observed.

## Batch 5.4 — Real GitHub Actions orchestration

### Implemented

- `GET /api/projects/build/verification` reads the real GitHub run and jobs for a tracked build.
- `verified: true` requires a `workflow_dispatch` run on the expected ref, `status: completed`,
  `conclusion: success`, all jobs completed and no failed steps. Dispatch-only builds return
  `verified: false` with reason `dispatch_only`.
- Failed-step summaries and expected/actual event and branch are returned for diagnosis.

### Verified

- `cd cloud && npm test`: **50 passed, 0 failures** (47 prior + 3 new Actions tests).
- Tests prove dispatch acceptance is never success, a real successful conclusion is verified, and a
  failed conclusion reports its failed step without being verified.

### Blocked

No real GitHub Actions run was dispatched by the application here; live orchestration remains blocked
by the missing OAuth connection and deployed backend.

## Batch 5.5 — Signed APK delivery

### Implemented

- Generated signed-release and debug build workflows now write full `apksigner`, `aapt dump badging`
  and `sha256sum` output into an evidence artifact on GitHub-hosted runners. Only protected Actions
  secret names are referenced; no signing value is printed or stored.
- Added `cloud/src/apk-evidence.ts` and `GET /api/projects/build/apk-verification` to verify a
  successful run's APK against its evidence artifact: SHA-256 match, `apksigner` success marker,
  package name, version and supported architectures. `verified` is false on any mismatch or missing
  evidence.
- Existing APK download link, `X-APK-Sha256` header and checksum endpoint are preserved.
- Added `scripts/check-signing-secrets.mjs`, which lists only the four required signing secret
  **names** via `gh secret list` and never reads values. It exits `0` only when all four are present.

### Verified

- `cd cloud && npm test`: **57 passed, 0 failures** (50 prior + 4 evidence-parser tests +
  3 API verification tests).
- Controlled tests prove valid evidence verifies, checksum mismatch fails, and missing evidence
  artifact blocks verification. Templates still contain no signing values.
- Repository Actions secret listing is empty here, so the signing preflight correctly reports the
  four required names as missing (run after network access to `gh`).
- Real **debug** APK artifact `14949062673` from Android CI `45453671763` on `7c77c06` was downloaded
  and inspected: ZIP integrity passed, APK SHA-256 is
  `c85777ad70b1bb940ef2e998e0a8fe3e95a1c39c8c38908430dd8271f323acf3`, package
  `com.sikorokoro44.cloudopencode.debug`, version `0.1.0` (code `1`), minSdk `26`, targetSdk `35`,
  ABIs `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`. This is **not** a signed production release and
  no cryptographic signature verification was performed locally.

### Blocked

No real signed APK was built, downloaded or signature-verified here. Signing secrets and a real
successful Actions release run are required. There is no APK download link or checksum to report as
live evidence.

## Batch 5.6 — Real-device verification

### Implemented

- `scripts/verify-device.mjs` verifies an existing APK on a non-emulator `adb` device. It rejects
  emulators, missing/unauthorized devices and failed install/launch; `status: verified` requires
  `adb install -r`, `pm path` and a launcher launch to succeed and includes device serial, package,
  APK SHA-256 and timestamp.
- `docs/DEVICE_TESTING.md` records the exact procedure and evidence format. No local Android build
  is performed; the APK must come from a successful GitHub Actions run.

### Verified

- `cd cloud && npm test`: **60 passed, 0 failures** (57 prior + 3 device-tooling tests, using a
  simulated `adb` binary and clearly labeled as simulation, not device evidence).
- Running the checker in this environment with a temporary APK returned:
  `{"status":"blocked","reason":"adb_unavailable"}` with exit code `2`.

### Blocked

No `adb`, physical Android device or real signed APK is available here. Physical-device installation
and launch are **not** verified. Emulator smoke tests in Android CI are not physical-device evidence.

## Phase 5 result

- Automated-test verified: 60 backend tests, masked deployment/config checks and both CI workflows
  on the final Phase 5 HEAD `a161f93`: `Cloud Backend CI` `45449895058` **success** and
  `Android CI` `45449895378` **success** (all three jobs, including emulator smoke and HTTPS
  integration).
- Live-service verified: none. No OAuth consent, deployed backend, real repository commit,
  application-dispatched Actions run or live APK artifact was observed.
- APK verified: none. No real signed APK, download link or checksum exists in this environment; only
  controlled evidence-parser and mocked-provider tests were executed.
- Physical-device verified: none. The device checker reports `adb_unavailable`.
- Outstanding external requirements: permanent HTTPS deployment, GitHub OAuth App and browser
  consent, an AI provider key, protected Android signing secrets, a real successful GitHub Actions
  release run, and a connected physical Android device.
