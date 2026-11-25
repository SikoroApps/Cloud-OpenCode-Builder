import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflowPath = new URL("../../.github/workflows/android-release.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");

test("signed release workflow is manual and secret-gated", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s{2}push:/m);
  for (const secret of [
    "ANDROID_KEYSTORE_BASE64",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
});

test("signed release workflow verifies and uploads the APK", () => {
  assert.match(workflow, /assembleRelease/);
  assert.match(workflow, /apksigner/);
  assert.match(workflow, /verify --verbose --print-certs/);
  assert.match(workflow, /sha256sum "\$APK"/);
  assert.match(workflow, /com\.sikorokoro44\.cloudopencode/);
  assert.match(workflow, /name: app-release-signed/);
  assert.match(workflow, /name: app-release-signed-evidence/);
});

test("signed release workflow requires an https backend url", () => {
  assert.match(workflow, /CLOUD_BASE_URL/);
  assert.match(workflow, /must use https/);
  assert.match(workflow, /vars\.CLOUD_BASE_URL/);
});
