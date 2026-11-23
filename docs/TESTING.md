# Testing

- Unit tests run on the JVM via `./gradlew testDebugUnitTest`.
- Instrumentation smoke tests run on a GitHub-hosted API 35 emulator.
- Lint runs via `./gradlew lintDebug`.
- CI assembles a debug APK and verifies its package name and secret markers.