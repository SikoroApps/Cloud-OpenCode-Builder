import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, consumeBuildDownloadGrant, saveBuildDownloadGrant } from "../src/db.ts";

test("download grants are consumed atomically and expire", () => {
  process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-grants-")), "test.sqlite");
  closeDb();
  const now = Date.now();
  saveBuildDownloadGrant({
    tokenHash: "grant-one",
    userId: "user-1",
    buildId: "build-1",
    artifactId: 42,
    now,
    expiresAt: now + 60_000,
  });
  saveBuildDownloadGrant({
    tokenHash: "grant-expired",
    userId: "user-1",
    buildId: "build-1",
    artifactId: 43,
    now: now - 120_000,
    expiresAt: now - 1,
  });

  const first = consumeBuildDownloadGrant("grant-one", now);
  const replay = consumeBuildDownloadGrant("grant-one", now);
  assert.equal(first?.userId, "user-1");
  assert.equal(first?.artifactId, 42);
  assert.equal(replay, undefined);
  assert.equal(consumeBuildDownloadGrant("grant-expired", now), undefined);
  closeDb();
});
