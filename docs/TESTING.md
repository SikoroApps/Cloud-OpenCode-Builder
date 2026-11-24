# Testing

## Backend

Run from `cloud/`:

- `npm test` — Node test runner; includes Phases 2–8 API, security and provider-parser tests.
- `npm run typecheck` — syntax/type-strip check for the server entry point.
- `npm run check:config` — masked readiness check (no secret values printed).
- `npm run check:deployment` — masked deployment preflight (no secret values printed).

Current result (2026-11-24): **74 passed, 0 failed**. New advanced-feature coverage:

- `tests/phase6-images.test.ts` — upload, MIME sniffing, path sanitization, owner scoping, analysis.
- `tests/phase7-image-generation.test.ts` — fixed URL, prompt/size, provider failures, validation.
- `tests/phase8-web-search-tasks.test.ts` — DDG parsing, live-safe URL filtering, search-grounded
  chat, persistent tasks and restart persistence.

Tests that use injected providers or `CLOUD_AI_STUB`/`CLOUD_WEB_SEARCH_STUB` are **controlled tests**,
not live-provider evidence. Live evidence is recorded in the phase docs and master tracker.

## Android

Run from `android/`:

- `./gradlew testDebugUnitTest` — JVM unit tests.
- `./gradlew :backend:test` — pure-JVM backend core tests.
- `./gradlew lintDebug` — Android lint.
- `./gradlew assembleDebug` — debug APK.
- `./gradlew connectedDebugAndroidTest` — emulator instrumentation tests.

CI runs all of the above on GitHub-hosted runners. There is no local Android SDK in the autonomous
execution environment, so local Android builds are not claimed. Latest verified run: `Android CI`
`45510042640` on `a0d6b21` (**success**, all three jobs). Its HTTPS instrumentation test now covers
image upload/list/analysis, image generation, web search and the task lifecycle against the backend
with deterministic stubs.

## Live provider checks

- Pollinations image generation was called live on 2026-11-24 and the stored generated-image SHA-256
  was verified after a backend restart.
- DuckDuckGo HTML search was called live on 2026-11-24 and real Android developer results were
  parsed.
- OpenRouter image understanding requires `OPENROUTER_API_KEY`; it remains live-blocked here.
- GitHub OAuth/Actions, signed APK and physical-device tests remain blocked on external credentials
  and hardware (see `docs/MASTER_COMPLETION_TRACKER.md`).
