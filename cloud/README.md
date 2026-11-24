# Cloud OpenCode backend

Node.js (22+) service providing sessions, persistent chat history and five-model free AI fallback.

## Run locally

```sh
cd cloud
npm test
CLOUD_DB_PATH=/tmp/cloud-opencode-backend.sqlite PORT=8080 HOST=127.0.0.1 \
  node src/index.ts
```

Health check: `GET http://127.0.0.1:8080/health` -> `{"status":"ok"}`.

## Configuration (environment variables only)

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no | HTTP port (default `8080`). |
| `HOST` | no | Bind host (default `0.0.0.0`). |
| `CLOUD_BASE_URL` | no | Public base URL (informational config validation). |
| `CLOUD_DB_PATH` | no | SQLite file path; must be on a persistent volume in production. |
| `OPENCODE_BASE_URL` | no | OpenCode API base URL (default `http://127.0.0.1:49374`). |
| `OPENCODE_API_KEY` | for OpenCode models | OpenCode service password/API key. |
| `OPENROUTER_API_KEY` | for OpenRouter models | OpenRouter API key. |

Never put keys in source, Dockerfiles, git, logs or client builds. Supply them as deployment secrets.

## Endpoints

- `GET /health`
- `GET /api/models`
- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `GET /api/auth/me`
- `GET /api/chat/history?sessionKey=...`
- `POST /api/chat` with `{ "sessionKey": "...", "content": "..." }`

Chat responses report the actual answering model in `ai.model` and attempted models in `ai.attempts`.

## Container deployment

```sh
cd cloud
docker build -t cloud-opencode-backend:local .
docker run --rm -p 8080:8080 \
  -v cloud-opencode-data:/data \
  -e OPENCODE_API_KEY -e OPENROUTER_API_KEY \
  cloud-opencode-backend:local
```

The container binds `0.0.0.0` and stores SQLite data under `/data` (mount a persistent volume).
Terminate TLS at the hosting platform or a reverse proxy; the Android client refuses any backend
URL that is not `https://` (and optionally restricts the host allowlist).

## Deployment status

No live cloud deployment exists yet. Hosting account, HTTPS domain and provider secret configuration
are external dependencies; they are intentionally not fabricated or committed. See `docs/PHASE_2.md`.
