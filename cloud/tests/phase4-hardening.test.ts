import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { decryptToken, encryptToken } from "../src/github.ts";
import { parseAiFilePlan, validateFileContent, validateFilePath } from "../src/files.ts";

test("GitHub tokens are encrypted at rest and authenticated decryption rejects tampering", () => {
  const token = "gh-token-do-not-expose";
  const key = randomBytes(32);
  const encrypted = encryptToken(token, key);
  assert.equal(decryptToken(encrypted, key), token);
  assert.equal(JSON.stringify(encrypted).includes(token), false);

  const tampered = { ...encrypted, tag: Buffer.from(randomBytes(16)).toString("base64") };
  assert.throws(() => decryptToken(tampered, key));
});

test("protected paths cannot be written through project file editing", () => {
  for (const path of [
    ".env",
    ".env.production",
    ".github/workflows/android-build.yml",
    "gradle.properties",
    "app/gradle.properties",
    "local.properties",
    "keystore.properties",
    "app/release.jks",
    "google-services.json",
  ]) {
    assert.throws(() => validateFilePath(path), /protected_file_path/);
  }
  assert.equal(validateFilePath("app/src/main/java/App.kt"), "app/src/main/java/App.kt");
});

test("secret-bearing file content is rejected before it can be planned or committed", () => {
  const tokenContent = "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  assert.throws(() => validateFileContent(tokenContent), /sensitive_content_rejected/);
  assert.throws(() => validateFileContent("-----BEGIN PRIVATE KEY-----\nabc\n"), /sensitive_content_rejected/);
  assert.throws(() => parseAiFilePlan(JSON.stringify({
    operations: [{ path: "README.md", content: tokenContent }],
  })), /sensitive_content_rejected/);
  assert.equal(validateFileContent("# safe README\n"), "# safe README\n");
});
