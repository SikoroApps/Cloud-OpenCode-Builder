# Phase 6 — Image uploads and image understanding

Phase 6 is the first advanced-feature phase documented in `README.md` ("Image uploads and image
understanding") and in `docs/BUILD_ORDER.md` ("Advanced features, planned after Phase 5"). It does
not change the Phase 1–5 roadmap or the approved five-model text fallback chain.

## Status

**IMPLEMENTED AND AUTOMATED-TEST VERIFIED; LIVE IMAGE UNDERSTANDING BLOCKED BY A PROVIDER KEY.**

Upload, storage, retrieval and owner scoping are working. The vision-analysis call is implemented
against a free OpenRouter vision model, but live understanding could not be exercised because this
environment has no `OPENROUTER_API_KEY`. Controlled tests use an injected analysis service and do
not claim a live vision result.

## Batch 6.1 — Image upload and persistent storage

### Implemented

- `POST /api/images` accepts a JSON body with `dataBase64`, `mimeType` and an optional `filename`.
- Images are validated by magic bytes, not only the declared MIME type. Supported formats are PNG,
  JPEG, WebP and GIF. Declared/actual type mismatches are rejected.
- Maximum decoded size is 5 MiB. The JSON body cap is sized from that limit and oversized bodies
  return `413 payload_too_large`.
- Filenames are reduced to a single safe basename; path separators, `..` and unsafe characters
  cannot escape storage.
- Images are persisted in SQLite in the existing persistent `/data` volume, associated with the
  authenticated user and optionally with one of that user's projects.
- `GET /api/images` lists metadata only. `GET /api/images/:id` returns metadata.
  `GET /api/images/:id/content` returns the bytes with `X-Content-Type-Options: nosniff`,
  `Cache-Control: private, max-age=300` and an inline filename.
- Every endpoint enforces authentication and user ownership. A different user receives
  `404 image_not_found` and cannot read the bytes or metadata.

### Tests

`cloud/tests/phase6-images.test.ts` covers:

- successful upload, metadata, listing and byte-for-byte content retrieval;
- path-traversal filename sanitization;
- invalid base64, spoofed MIME type and unauthenticated upload rejection;
- owner-only metadata, content and analysis access;
- stored SHA-256 and response shape without base64 bulk in list responses.

## Batch 6.2 — Image understanding

### Implemented

- `POST /api/images/:id/analyze` with `{ "prompt": "..." }` loads the owner's stored image and calls
  an injected `ImageAnalysisService`.
- The default service uses the free OpenRouter vision model configured by
  `IMAGE_UNDERSTANDING_MODEL` (default `google/gemma-3-27b-it:free`) and the existing
  `OPENROUTER_API_KEY` backend secret. No key is embedded in the Android app or repository.
- A 45-second timeout, 4,000-character prompt limit and a 1,024-token response cap bound the call.
- When no key is configured the endpoint returns `503 image_understanding_not_configured` instead of
  inventing a result. Provider failures return `502 image_understanding_failed`.
- `CLOUD_AI_STUB=1` provides a deterministic local stub for CI and controlled tests; stub results
  are explicitly labelled `stub/local-test`.

### Tests

`cloud/tests/phase6-images.test.ts` proves the route is owner-scoped, passes the correct bytes/MIME
type to the analysis service, returns the model/content and never echoes credentials.

### Live evidence

Not available in this environment:

- `OPENROUTER_API_KEY` is unset, so a real vision request cannot be made.
- The controlled tests are not a live-provider claim.

### Exact external requirement

Set `OPENROUTER_API_KEY` in the backend secret store (and optionally `IMAGE_UNDERSTANDING_MODEL`),
then upload a real image and call `/api/images/<id>/analyze`. The key must belong to a free-tier
model; no paid requirement was introduced.

## Android client

`CloudApiClient` exposes `uploadImage`, `listImages`, `analyzeImage` and image metadata fields.
Android CI run `45508407058` compiled these methods and exercised upload, list and analysis over a
temporary HTTPS tunnel with the deterministic stub. No Compose image-picker/analysis screen exists
yet, so end-user UI usage is not claimed.

## Security review

- No image bytes are written to a user-controlled filesystem path.
- MIME sniffing prevents an HTML or executable payload from being stored as an image.
- Responses never include OAuth tokens or provider keys.
- User and project ownership are checked before any read or analysis.
- Image bytes are served with `nosniff` and an inline content disposition.

## Result

- Code and automated tests: **COMPLETE**.
- Live upload/storage against a running backend: verified by the HTTP tests.
- Live image understanding against an upstream vision provider: **BLOCKED** on
  `OPENROUTER_API_KEY`.
