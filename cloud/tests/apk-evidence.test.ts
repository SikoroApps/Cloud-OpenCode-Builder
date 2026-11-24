import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyApkEvidence } from "../src/apk-evidence.ts";

const apkBytes = Buffer.from("signed-release-apk-bytes");
const sha256 = createHash("sha256").update(apkBytes).digest("hex");

function evidence(overrides: { checksum?: string; signature?: string; badging?: string } = {}): string {
  return [
    "=== apksigner verify --verbose --print-certs ===",
    overrides.signature ?? "Verifies\nVerified using v2 scheme (APK Signature Scheme v2): true",
    "=== aapt dump badging ===",
    overrides.badging ?? "package: name='com.sikorokoro44.cloudopencode' versionCode='1' versionName='0.1.0'\nnative-code: 'arm64-v8a' 'armeabi-v7a'",
    "=== sha256sum ===",
    `${overrides.checksum ?? sha256}  app-release.apk`,
  ].join("\n");
}

test("valid signed APK evidence is verified with package, version and architectures", () => {
  const result = verifyApkEvidence(apkBytes, evidence());
  assert.equal(result.verified, true);
  assert.equal(result.signatureVerified, true);
  assert.equal(result.checksumMatches, true);
  assert.equal(result.packageName, "com.sikorokoro44.cloudopencode");
  assert.equal(result.versionName, "0.1.0");
  assert.deepEqual(result.supportedArchitectures, ["arm64-v8a", "armeabi-v7a"]);
  assert.equal(result.sizeInBytes, apkBytes.length);
});

test("checksum mismatch fails verification", () => {
  const result = verifyApkEvidence(apkBytes, evidence({ checksum: "0".repeat(64) }));
  assert.equal(result.checksumMatches, false);
  assert.equal(result.verified, false);
});

test("failed signature evidence fails verification", () => {
  const result = verifyApkEvidence(apkBytes, evidence({ signature: "DOES NOT VERIFY" }));
  assert.equal(result.signatureVerified, false);
  assert.equal(result.verified, false);
});

test("unexpected package name fails verification", () => {
  const result = verifyApkEvidence(apkBytes, evidence({ badging: "package: name='com.example.other' versionCode='1' versionName='1.0'" }));
  assert.equal(result.packageName, "com.example.other");
  assert.equal(result.verified, false);
});
