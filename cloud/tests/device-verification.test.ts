import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cloudRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(dirname(cloudRoot), "scripts", "verify-device.mjs");

function fakeAdb(withDevice: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "co-fake-adb-"));
  const path = join(dir, "adb");
  writeFileSync(path, `#!/bin/sh
if [ "$1" = "version" ]; then echo "Android Debug Bridge version 1.0.41"; exit 0; fi
if [ "$1" = "devices" ]; then
  echo "List of devices attached"
  ${withDevice ? 'echo "ABCDEF123456 device"' : "true"}
  exit 0
fi
if [ "$1" = "-s" ] && [ "$3" = "install" ]; then echo "Success"; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "shell" ] && [ "$4" = "pm" ]; then echo "package:/data/app/com.sikorokoro44.cloudopencode/base.apk"; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "shell" ] && [ "$4" = "monkey" ]; then echo "Events injected: 1"; exit 0; fi
exit 1
`);
  chmodSync(path, 0o755);
  return path;
}

function apkFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "co-device-apk-"));
  const path = join(dir, "app-release.apk");
  writeFileSync(path, "simulated-signed-apk-bytes");
  return path;
}

function runScript(apk: string, adb: string): { code: number | null; report: any } {
  const result = spawnSync(process.execPath, [scriptPath, "--apk", apk], {
    env: { ...process.env, ADB_BIN: adb },
    encoding: "utf8",
  });
  return { code: result.status, report: JSON.parse(result.stdout || "{}") };
}

test("device verification is blocked when adb is unavailable", () => {
  const result = runScript(apkFile(), join(mkdtempSync(join(tmpdir(), "co-no-adb-")), "missing-adb"));
  assert.equal(result.code, 2);
  assert.equal(result.report.status, "blocked");
  assert.equal(result.report.reason, "adb_unavailable");
  assert.equal(result.report.apkSha256, createHash("sha256").update("simulated-signed-apk-bytes").digest("hex"));
});

test("device verification is blocked when no authorized physical device is attached", () => {
  const result = runScript(apkFile(), fakeAdb(false));
  assert.equal(result.code, 2);
  assert.equal(result.report.status, "blocked");
  assert.equal(result.report.reason, "no_authorized_physical_device");
});

test("simulated adb success produces verified evidence with device and checksum", () => {
  const result = runScript(apkFile(), fakeAdb(true));
  assert.equal(result.code, 0);
  assert.equal(result.report.status, "verified");
  assert.equal(result.report.device, "ABCDEF123456");
  assert.equal(result.report.package, "com.sikorokoro44.cloudopencode");
  assert.equal(result.report.installedPath, "/data/app/com.sikorokoro44.cloudopencode/base.apk");
  assert.equal(result.report.verifiedAt !== null, true);
});
