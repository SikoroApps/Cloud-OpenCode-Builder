import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { findZipFileByExtension } from "../src/zip.ts";
import { makeStoredZip } from "./test-zip.ts";

test("APK is read from an artifact ZIP without extracting other files", () => {
  const zip = makeStoredZip([
    { name: "README.txt", content: "not an apk" },
    { name: "app/build/outputs/apk/debug/app-debug.apk", content: "APK-BYTES" },
  ]);
  const entry = findZipFileByExtension(zip, ".apk");
  assert.equal(entry?.filename, "app/build/outputs/apk/debug/app-debug.apk");
  assert.equal(Buffer.from(entry!.content).toString("utf8"), "APK-BYTES");
  assert.equal(findZipFileByExtension(zip, ".jks"), null);
});

test("invalid ZIP data is rejected safely", () => {
  assert.equal(findZipFileByExtension(new Uint8Array([1, 2, 3]), ".apk"), null);
});
