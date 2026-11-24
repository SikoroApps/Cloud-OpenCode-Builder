# Phase 8 — Real-time web search and persistent cloud tasks

Phase 8 implements the remaining advanced backlog recorded in `README.md` and
`docs/BUILD_ORDER.md`: real-time web search, plus the persistent cloud-task foundation required for
work that continues after the phone disconnects. It builds on the Phase 1–7 backend and does not
change the approved text-model fallback chain.

## Status

**COMPLETE AND LIVE-VERIFIED** for web search (DuckDuckGo HTML provider) and persistent task storage.

## Batch 8.1 — Real-time web search

### Implemented

- `POST /api/search` accepts `{ "query": "...", "limit": 1..10 }`.
- Queries are normalized, capped at 500 characters and URL-encoded.
- The default provider is DuckDuckGo's HTML endpoint; the host is fixed and configurable only through
  the backend `WEB_SEARCH_ENDPOINT` environment variable, not from client input.
- Requests have a 15-second timeout and a bounded user agent.
- The parser extracts result titles, snippets and target URLs, decodes HTML entities, follows
  DuckDuckGo redirect links and rejects non-HTTP(S) or malformed URLs.
- `POST /api/chat` accepts `{ "webSearch": true }`. Search results are injected as bounded system
  context before the normal five-model text fallback, and the response includes the source list so
  the client can show citations. Conversation history remains persisted as before.
- Search failures return a safe `502 web_search_failed` without upstream body details.
- `CLOUD_WEB_SEARCH_STUB=1` supplies deterministic offline results for CI/controlled tests; stub
  results are labelled `stub/local-test` and are not used as live evidence.

### Tests

`cloud/tests/phase8-web-search-tasks.test.ts` covers:

- real DuckDuckGo result markup parsing, entity decoding and redirect URL normalization;
- unsafe `javascript:` URL rejection;
- provider failure handling;
- chat with web-search context and persisted two-message history;
- safe error responses that do not leak upstream details.

### Live evidence (2026-11-24)

- A direct live request to `https://html.duckduckgo.com/html/?q=android+jetpack+compose` returned
  HTTP 200.
- The parser returned five structured results; the first was
  `Jetpack Compose UI App Development Toolkit - Android Developers` at
  `https://developer.android.com/compose`.
- A running backend `POST /api/search` with query `android jetpack compose` and limit 3 returned
  **HTTP 200**, `provider: "duckduckgo_html"` and real Android developer documentation URLs.
- This is a real upstream search response, not a fixture.

## Batch 8.2 — Persistent cloud tasks

### Implemented

- New `cloud_tasks` SQLite table in the existing persistent `/data` volume.
- `POST /api/tasks` creates a queued task with a normalized description (1–2,000 characters) and an
  optional project owned by the caller.
- `GET /api/tasks` lists the caller's tasks, optionally filtered by project.
- `GET /api/tasks/:id` returns one owned task.
- `PATCH /api/tasks/:id` moves a task through `queued`, `running`, `succeeded`, `failed` or
  `cancelled`; invalid states are rejected.
- `DELETE /api/tasks/:id` marks a task cancelled.
- All task reads and writes are scoped to the authenticated user; another user receives
  `404 task_not_found`.
- Because tasks live in SQLite on the persistent volume, they survive backend restarts and do not
  depend on the phone staying connected.

### Tests

`cloud/tests/phase8-web-search-tasks.test.ts` proves create/list/update/cancel, invalid status
rejection, owner scoping, and persistence across a real backend restart using the same SQLite file.

### Live evidence (2026-11-24)

- A live backend created task `533af700-af9e-4452-a212-30ff975d1321` with status `queued`
  (HTTP 201).
- The backend was stopped and restarted against the same SQLite database; an authenticated
  `GET /api/tasks` returned the same task, proving persistence across restart.

## Android client

`CloudApiClient` now exposes:

- `webSearch(token, query, limit)`;
- `createTask`, `listTasks`, `updateTask` and `cancelTask`;
- `sendChat(..., webSearch = true)` to request search-grounded chat.

Android CI run `45508407058` compiles these methods and exercises `webSearch` plus the full task
create/list/update/cancel lifecycle over a temporary HTTPS tunnel with deterministic stubs.

## Security review

- Search input is bounded, encoded and sent only to a fixed backend-selected host.
- Search result URLs are restricted to HTTP(S); `javascript:` and malformed targets are dropped.
- Search HTML is converted to text, not rendered as HTML in the client.
- Task and image ownership checks run before every read/write.
- No search or task endpoint returns a provider key or OAuth token.
- Task descriptions are length-bounded and stored as data, never executed as shell commands.

## Result

- Web search code, tests and live provider call: **COMPLETE**.
- Persistent task code, tests and live restart persistence: **COMPLETE**.
- Android client surface: **IMPLEMENTED**; compile/emulator verification is performed by Android CI.
