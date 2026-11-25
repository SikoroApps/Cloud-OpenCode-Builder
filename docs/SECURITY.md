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
  still checks build ownership and successful conclusion.
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
  suite passed **95/95** locally and in CI on `73d4289`.

## Dependency audit

- Automated on every push and weekly: the backend has zero npm dependencies (`npm audit` verified
  0 findings), and all pinned Gradle coordinates are checked against OSV by
  `scripts/audit-dependencies.mjs`. Dependabot alerts are enabled and dependency updates are
  proposed weekly. See `docs/MASTER_COMPLETION_TRACKER.md`.

## Remaining external requirements

- Live production secrets, HTTPS hosting and a signed release remain external requirements; see
  `docs/MASTER_COMPLETION_TRACKER.md`.
