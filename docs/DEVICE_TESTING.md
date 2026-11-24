# Physical-device verification

This procedure verifies installation and launch of an **existing** APK on a physical Android device.
It never builds locally; Android builds are performed by GitHub Actions.

## Requirements

- Android platform-tools (`adb`) available on PATH, or set `ADB_BIN` to its absolute path.
- A physical Android device (API 26+) connected with USB debugging authorized. Emulators are
  deliberately rejected and are not physical-device evidence.
- The signed APK downloaded from a successful GitHub Actions run, with its SHA-256 already verified
  by `GET /api/projects/build/apk-verification`.

## Run

```sh
node scripts/verify-device.mjs \
  --apk /path/to/app-release.apk \
  --package com.sikorokoro44.cloudopencode
```

The script writes a JSON report to stdout:

- `status: verified` only when `adb install -r`, `pm path` and a launcher launch (`monkey`) all
  succeed on a non-emulator device. It includes the device serial, package, APK SHA-256, installed
  path and timestamp.
- `status: blocked` with a reason such as `adb_unavailable`, `no_authorized_physical_device`,
  `apk_not_found` or `apk_not_provided`.
- `status: failed` when installation or launch does not succeed.

Exit codes: `0` verified, `1` failed, `2` blocked. A blocked or failed result must never be reported
as device verification.

## Current environment

No physical device or `adb` tool is available in this harness. The script reports
`adb_unavailable` here, so physical-device verification is **not** completed.
