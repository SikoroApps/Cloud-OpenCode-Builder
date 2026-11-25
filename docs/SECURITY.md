# Security baseline

- Never commit API keys, passwords, signing keys, OAuth secrets or tokens.
- Use secure secret storage (GitHub Actions secrets / cloud secret manager). Backend configuration is
  environment-only.
- Apply least-privilege GitHub permissions and scopes.
- Protect user repositories and project data; every project, image and task operation is scoped to
  the authenticated user.
- Never expose private credentials in logs or error responses. Provider errors are mapped to safe
  codes.
- CI scans the built debug APK for server secret markers.

## Implemented controls

- GitHub OAuth uses one-time hashed state with a 10-minute expiry; tokens are exchanged server-side,
  encrypted with AES-256-GCM and never returned to Android.
- APK artifact downloads use a 10-minute, single-use, hash-only grant, consumed atomically with one
  `DELETE ... RETURNING` so concurrent replays cannot both succeed. Authenticated artifact access
  still checks build ownership and successful conclusion. GitHub artifact ZIP bodies are streamed
  through a byte cap rather than allocated solely on a client-supplied `content-length`.
- Project file editing rejects protected paths (`.env*`, `.github/*`, Gradle/keystore properties,
  keystores, certificates and Firebase config) and secret-bearing content.
- Image upload validates magic bytes (not only the declared MIME type), caps input at 5 MiB and
  sanitizes filenames. Image content is served with `X-Content-Type-Options: nosniff`.
- Image generation uses a fixed provider host, allowlisted sizes and encoded prompts, preventing
  SSRF and query injection.
- Web search uses a fixed provider host, bounded queries, HTTP(S)-only normalized result URLs and
  plain-text parsing.
- JSON request bodies are bounded (1 MiB default; a larger bound only for image upload).
- Task descriptions are length-bounded data and are never executed as shell commands.
- No new npm dependency was added for Phases 6–8.

## Abuse protection

- Dependency-free fixed-window rate limits cover registration/login (20 per 15 min per IP),
  OAuth start (10 per 10 min per user), chat/search/image analysis (30/min per user), image
  generation/task creation (20/min per user), and all other authenticated API routes (300/min
  per IP).
- 429 responses include `Retry-After`; all limited responses expose `X-RateLimit-Limit`,
  `X-RateLimit-Remaining` and `X-RateLimit-Reset`. State is in memory and isolated per process.
- `X-Forwarded-For` is honoured only when `TRUST_PROXY=1`; direct backend access must remain bound
  to loopback behind Caddy. Horizontal scaling requires a shared limiter before it can be called
  production-safe.
- Five tests cover window resets, key bounds, proxy handling, policy selection and real HTTP
  429 headers; the OAuth callback is rate-limited separately from OAuth start. The full backend
  suite passed **118/118** on final Phase 9 checkpoint `5a0def3` (previously 96/96 after artifact
  hardening).

## Dependency audit

- Automated on every push and weekly: the backend has zero npm dependencies (`npm audit` verified
  0 findings), and all pinned Gradle coordinates are checked against OSV by
  `scripts/audit-dependencies.mjs`. Dependabot alerts are enabled and dependency updates are
  proposed weekly. See `docs/MASTER_COMPLETION_TRACKER.md`.

## Phase 9 production controls

- Production startup now fails fast with stable error codes when `CLOUD_BASE_URL` is not HTTPS,
  rate limiting is disabled, `TRUST_PROXY` is not enabled, OAuth credentials are incomplete, the
  callback host/path is inconsistent, or the mobile callback scheme is not `cloudopencode:`. No URL
  or credential value appears in the error.
- The deploy-file checker verifies loopback-only backend binding, persistent SQLite storage, a
  healthy-backend dependency, Caddy HTTPS termination and security headers.
- `npm run generate:key` emits one 32-byte key once to stdout with a stderr warning to store it only
  in a secret manager; it never writes a file.
- `npm run verify:ai` and `npm run check:release` print only status, names, booleans, blocker codes
  and HTTP status. Live workflows inject provider keys by GitHub Actions secret reference only.
- `docs/PHASE_9.md` records honest `BLOCKED` workflow results when keys/hosting are absent.

## Remaining external requirements

- Live production secrets, HTTPS hosting, production signing identity and physical-device
  verification remain external requirements; see `docs/PHASE_9.md` and
  `docs/MASTER_COMPLETION_TRACKER.md`.
