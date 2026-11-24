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
