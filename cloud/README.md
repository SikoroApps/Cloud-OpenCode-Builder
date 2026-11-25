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
| `OPENROUTER_API_KEY` | for OpenRouter models and image understanding | OpenRouter API key. |
| `IMAGE_UNDERSTANDING_MODEL` | no | Free OpenRouter vision model (default `google/gemma-3-27b-it:free`). |
| `IMAGE_GENERATION_URL` | no | Fixed image-generation provider base URL (default Pollinations prompt endpoint). |
| `WEB_SEARCH_ENDPOINT` | no | Fixed search provider endpoint (default DuckDuckGo HTML). |
| `CLOUD_AI_STUB` | tests only | Deterministic text/image-analysis stub. Never enable in production. |
| `CLOUD_IMAGE_GENERATION_STUB` | tests only | Deterministic 1×1 PNG image-generation stub. |
| `CLOUD_WEB_SEARCH_STUB` | tests only | Deterministic search-results stub. |
| `RATE_LIMIT_ENABLED` | no | Set to `0` only in local tests to disable in-memory limits; defaults to enabled. |
| `TRUST_PROXY` | no | Set to `1` only when Caddy or a known reverse proxy is the sole public entry point; enables `X-Forwarded-For` for per-client keys. Defaults to off. |

Never put keys in source, Dockerfiles, git, logs or client builds. Supply them as deployment secrets.

Rate limits are dependency-free fixed windows: auth 20/15 min per IP, OAuth start 10/10 min per
user, chat/search/image analysis 30/min per user, image generation and task creation 20/min per
user, and all other authenticated API routes 300/min per IP. Responses include `X-RateLimit-*` and
429 responses include `Retry-After`. In-memory state is per process; a multi-replica deployment
needs a shared limiter before horizontal scaling.

## Endpoints

- `GET /health`
- `GET /api/models`
- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `GET /api/auth/me`
- `GET /api/chat/history?sessionKey=...`
- `POST /api/chat` with `{ "sessionKey": "...", "content": "...", "webSearch": true }` (the
  `webSearch` flag is optional). Chat responses report the actual answering model in `ai.model`,
  attempted models in `ai.attempts`, and search sources in `webSearch` when requested.
- `POST /api/images`, `GET /api/images`, `GET /api/images/:id`, `GET /api/images/:id/content`
- `POST /api/images/:id/analyze`, `POST /api/images/generate`
- `POST /api/search` with `{ "query": "...", "limit": 1..10 }`
- `POST /api/tasks`, `GET /api/tasks`, `GET|PATCH|DELETE /api/tasks/:id`

All endpoints below `/api` require the bearer token returned by register/login. Image and task
records are scoped to the authenticated user. Image bytes are served only through the authenticated
content endpoint.

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
