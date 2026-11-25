import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword, verifyPassword } from "../src/auth.ts";
import { insertUser, findUserByEmail, findUserById, insertSession, findSessionByHash, revokeSession } from "../src/db.ts";

test("password hashing verifies the original and rejects the wrong password", () => {
  const salt = "salttestsalt";
  const stored = hashPassword("correct-horse-battery", salt);
  assert.ok(stored.startsWith(`${salt}:`));
  assert.equal(verifyPassword("correct-horse-battery", stored), true);
  assert.equal(verifyPassword("wrong-password", stored), false);
});

test("user and session persistence round trip", () => {
  process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-db-")), "test.sqlite");
  const now = Date.now();
  insertUser("user-1", "user@example.com", hashPassword("password123", "salttestsalt"), "salttestsalt", now);
  const user = findUserByEmail("user@example.com");
  assert.ok(user);
  assert.equal(findUserById("user-1").email, "user@example.com");
  // One hour keeps this persistence assertion independent of test-runner scheduling delays.
  const session = insertSession("hash-abc", "user-1", now, now + 3_600_000);
  assert.equal(findSessionByHash("hash-abc").user_id, "user-1");
  revokeSession("hash-abc");
  assert.equal(findSessionByHash("hash-abc"), undefined);
});
