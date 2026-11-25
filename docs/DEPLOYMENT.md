# Cloud backend deployment contract

This document describes the only supported deployment shape for the Cloud OpenCode backend. It
contains no secret values and never asks for secrets to be pasted into chat or source files.

## Runtime

- Image: build from `cloud/Dockerfile` (`node:22-alpine`).
- Process: non-root `node` user.
- Listen: `HOST=0.0.0.0`, `PORT=8080` by default.
- Health: `GET /health` returns `{"status":"ok"}`; the Dockerfile includes a `HEALTHCHECK`.
- Persistence: SQLite at `CLOUD_DB_PATH`, default `/data/cloud-opencode-backend.sqlite` in the image.
  Mount a durable volume at `/data`. Losing this volume loses users, sessions and project state.
- TLS: terminate HTTPS at the hosting platform or a reverse proxy. The Android client rejects
  non-HTTPS backend URLs.

## Build and run

```sh
cd cloud
docker build -t cloud-opencode-backend:local .
docker run --rm -p 8080:8080 \
  -v cloud-opencode-data:/data \
  -e GITHUB_CLIENT_ID \
  -e GITHUB_CLIENT_SECRET \
  -e GITHUB_OAUTH_REDIRECT_URI \
  -e GITHUB_TOKEN_ENCRYPTION_KEY \
  -e CLOUD_BASE_URL \
  -e OPENCODE_API_KEY \
  cloud-opencode-backend:local
```

Use the platform's secret store for every `-e` value. Do not write a `.env` file into a public
repository, Docker layer, CI log or client build.

## Deployable image and single-host HTTPS setup

The `Publish backend image` GitHub Actions workflow builds `cloud/Dockerfile` on every push to
`main` and pushes a deployable container to GHCR using the built-in `GITHUB_TOKEN` (no external
credential):

```text
ghcr.io/<lowercase-owner>/cloud-opencode-backend:latest
ghcr.io/<lowercase-owner>/cloud-opencode-backend:sha-<commit>
```

For a single Linux host with Docker Compose and a public DNS domain, `deploy/docker-compose.yml`
and `deploy/Caddyfile` provide the complete runtime shape: the backend listens only on
`127.0.0.1:8080`, SQLite persists in the `backend-data` volume, and Caddy terminates HTTPS with an
automatic certificate. Simplest setup:

1. Point the domain's A/AAAA records at the host and open ports 80/443.
2. Copy `deploy/.env.example` to `deploy/.env` on the host and fill in the values there using the
   platform's secret store. `deploy/.env` is ignored by Git and must never be committed.
3. From the host's `deploy` directory: `docker compose up -d`.
4. Verify: `curl -fsS https://<CLOUD_DOMAIN>/health`.
5. Run `npm run check:deployment` against the deployed environment; it prints only booleans and
   blocker codes.
6. For a signed release in a generated app repository, check secret names only with
   `node scripts/check-signing-secrets.mjs <owner>/<app-repo>`.

Caddy waits for the backend container's Docker `HEALTHCHECK` to report healthy before starting, so a
broken backend does not receive HTTPS traffic. The backend port is bound to `127.0.0.1` only; public
traffic must go through Caddy.

GHCR packages may default to private. If the host should pull anonymously, set the package
visibility to public in the GitHub Packages settings. Otherwise authenticate the host with a token
that has `read:packages`. Anonymous manifest access returned HTTP 401 during Phase 5 verification,
so anonymous pulling was not confirmed.

This is a deployment shape and a published artifact, **not** a claim that a live deployment exists.
A host, DNS domain and configured secrets are still required, and no credential is requested here.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOST` | Bind address; defaults are `8080` and `0.0.0.0`. |
| `CLOUD_DB_PATH` | SQLite path; must be on the persistent volume in production. |
| `CLOUD_BASE_URL` | Public HTTPS base URL used for browser download links and OAuth. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth App credentials. |
| `GITHUB_OAUTH_REDIRECT_URI` | HTTPS callback URL for the deployed backend. |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Base64 of 32 random bytes for AES-256-GCM token storage. |
| `GITHUB_APP_CALLBACK_URL` | Mobile deep link used after OAuth redirects. |
| `OPENCODE_API_KEY`, `OPENROUTER_API_KEY` | At least one is required for live AI file planning. |
| `RATE_LIMIT_ENABLED` | Defaults to `1`; set to `0` only for isolated local tests. |
| `TRUST_PROXY` | Set to `1` when Caddy is the sole public entry point, so per-client limits use `X-Forwarded-For`; otherwise spoofable proxy headers are ignored. |

Repository Actions secrets for generated Android workflows are listed in
`docs/SECURITY.md` and `docs/PHASE_4.md`. Their values are never read by this backend.

## Masked readiness checks

```sh
cd cloud
npm run check:config              # presence/format only; no values printed
npm run check:deployment          # adds writable-directory and HTTPS health URL checks
npm run check:deployment -- --require-live  # exits 1 when live prerequisites are missing
```

`DEPLOYMENT_HEALTH_URL` may be set to the deployed HTTPS `/health` URL. The checker records only
its scheme and HTTP status. It never prints the URL, credentials, tokens or keys.

`GET /api/config/readiness` returns the same masked configuration summary to an authenticated user.

## Deployment gate

A deployment may be called live only when all of the following are true:

1. The container is running from a built image with a persistent `/data` volume.
2. `CLOUD_BASE_URL` is the real HTTPS domain.
3. The HTTPS `/health` URL returns HTTP 200.
4. GitHub OAuth values and a valid 32-byte encryption key are present.
5. At least one AI provider key is present.
6. Signing secrets are configured as protected GitHub Actions secrets in the app repository.

Until those are observed, the deployment is **not** claimed as live.
