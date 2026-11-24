import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cloudRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 18081;
const baseUrl = `http://127.0.0.1:${PORT}`;

function startServer(dbPath: string): ChildProcess {
  return spawn(process.execPath, ["src/index.ts"], {
    cwd: cloudRoot,
    env: {
      ...process.env,
      CLOUD_DB_PATH: dbPath,
      CLOUD_AI_STUB: "1",
      PORT: String(PORT),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error("server exited before becoming healthy");
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Server not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy");
}

async function stopServer(child: ChildProcess): Promise<void> {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

test("chat history and session auth persist across server restarts (stubbed AI, simulated)", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "co-api-")), "test.sqlite");
  const credentials = { email: "persist@example.com", password: "password-1234" };

  let server = startServer(dbPath);
  await waitForHealth(server);
  let response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  assert.equal(response.status, 201);
  const registered = (await response.json()) as any;
  const token = String(registered.token);

  response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionKey: "persist-test", content: "remember me" }),
  });
  assert.equal(response.status, 200);
  const firstTurn = (await response.json()) as any;
  assert.equal(firstTurn.ai.model, "stub/local-test");
  assert.equal(firstTurn.assistantMessage.content, "STUB:remember me");
  await stopServer(server);

  server = startServer(dbPath);
  await waitForHealth(server);
  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  assert.equal(response.status, 200);
  const secondToken = String(((await response.json()) as any).token);

  response = await fetch(`${baseUrl}/api/chat/history?sessionKey=persist-test`, {
    headers: { Authorization: `Bearer ${secondToken}` },
  });
  assert.equal(response.status, 200);
  const history = ((await response.json()) as any).history as any[];
  assert.equal(history.length, 2);
  assert.equal(history[0].content, "remember me");
  assert.equal(history[1].model, "stub/local-test");
  await stopServer(server);
});
