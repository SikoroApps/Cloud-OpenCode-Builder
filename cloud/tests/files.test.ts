import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAiFilePlan, validateFileContent, validateFilePath } from "../src/files.ts";

test("project file paths reject traversal, hidden and unsupported files", () => {
  assert.equal(validateFilePath("/app/src/MainActivity.kt"), "app/src/MainActivity.kt");
  assert.equal(validateFilePath(".gitignore"), ".gitignore");
  assert.throws(() => validateFilePath("../secrets.md"), /invalid_file_path/);
  assert.throws(() => validateFilePath("app\\src\\Main.kt"), /invalid_file_path/);
  assert.throws(() => validateFilePath("app/src/.hidden.kt"), /invalid_file_path/);
  assert.throws(() => validateFilePath("app/keystore.jks"), /unsupported_file_type/);
});

test("project file content is bounded to a safe UTF-8 size", () => {
  assert.equal(validateFileContent("class Main"), "class Main");
  assert.throws(() => validateFileContent("x".repeat(200_001)), /invalid_file_content/);
});

test("AI file plans parse JSON and validate every operation", () => {
  const plan = parseAiFilePlan([
    "```json",
    JSON.stringify({ operations: [
      { path: "README.md", content: "# Generated" },
      { path: "app/build.gradle.kts", content: "plugins {}" },
    ] }),
    "```",
  ].join("\n"));
  assert.deepEqual(plan.map((operation) => operation.path), ["README.md", "app/build.gradle.kts"]);
  assert.throws(
    () => parseAiFilePlan(JSON.stringify({ operations: [{ path: "../bad.md", content: "x" }] })),
    /invalid_file_path/,
  );
  assert.throws(() => parseAiFilePlan("not json"), /invalid_ai_file_plan/);
});
