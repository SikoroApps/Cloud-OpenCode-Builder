import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  androidScaffold,
  normalizeAppName,
  normalizePackageName,
  scaffoldBuildWorkflow,
} from "../src/scaffold.ts";
import { resolveUserByToken } from "../src/auth.ts";
import { closeDb, saveGithubConnection, saveProject, selectProject } from "../src/db.ts";
import { encryptToken } from "../src/github.ts";
import { baseDependencies, registerUser, startServer } from "./phase6-8-helpers.ts";

process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-scaffold-")), "test.sqlite");

test("scaffold produces a complete minimal Compose project", () => {
  const result = androidScaffold({ appName: "My Demo App", packageName: "com.acme.demo" });
  assert.equal(result.appName, "My Demo App");
  assert.equal(result.packageName, "com.acme.demo");
  const paths = Object.keys(result.files);
  for (const required of [
    "settings.gradle.kts",
    "build.gradle.kts",
    "app/build.gradle.kts",
    "app/src/main/AndroidManifest.xml",
    "app/src/main/res/values/strings.xml",
    "app/src/main/res/values/themes.xml",
    "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
    ".github/workflows/android-build.yml",
  ]) {
    assert.ok(paths.includes(required), `missing ${required}`);
  }
  const activity = result.files["app/src/main/java/com/acme/demo/MainActivity.kt"];
  assert.ok(activity?.includes("package com.acme.demo"));
  assert.ok(activity?.includes("ComponentActivity"));
  assert.ok(result.files["app/build.gradle.kts"]?.includes("applicationId = \"com.acme.demo\""));
  assert.ok(result.files["app/build.gradle.kts"]?.includes("minSdk = 26"));
  assert.ok(result.files["app/build.gradle.kts"]?.includes("org.jetbrains.kotlin.plugin.compose"));
  assert.ok(result.files["app/src/main/AndroidManifest.xml"]?.includes("android.intent.category.LAUNCHER"));
  const joined = Object.values(result.files).join("\n");
  assert.ok(!/ghp_|github_pat_|BEGIN (?:RSA |EC )?PRIVATE KEY|ANDROID_KEYSTORE_PASSWORD/.test(joined));
});

test("scaffold names are normalized and reject unsafe input", () => {
  assert.equal(normalizeAppName("  Hello   World  "), "Hello World");
  assert.throws(() => normalizeAppName("<script>alert(1)</script>"), /invalid_app_name/);
  assert.throws(() => normalizeAppName(""), /invalid_app_name/);
  assert.equal(normalizePackageName("My 42 App!", "My 42 App"), "com.example.my.app42.app");
  assert.equal(normalizePackageName("", "9 Lives"), "com.example.app9.lives");
});

test("generated build workflow assembles and verifies the APK without secrets", () => {
  const workflow = scaffoldBuildWorkflow();
  assert.ok(workflow.includes("gradle assembleDebug --no-daemon"));
  assert.ok(workflow.includes("apksigner verify --verbose"));
  assert.ok(workflow.includes("sha256sum"));
  assert.ok(workflow.includes("actions/upload-artifact@v4"));
  assert.ok(!workflow.includes("secrets."));
});

test("scaffold endpoint saves owner-scoped files, prevents clobbering and supports explicit replace", async () => {
  const key = randomBytes(32);
  const server = await startServer(baseDependencies({
    githubConfig: {
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://backend.example.invalid/api/github/oauth/callback",
      appCallbackUrl: "cloudopencode://github/callback",
      apiBaseUrl: "https://api.github.com",
      authBaseUrl: "https://github.com",
      tokenEncryptionKey: key,
    },
  }));
  try {
    const auth = await registerUser(server.baseUrl);
    const token = String(auth.Authorization.replace("Bearer ", ""));
    const user = resolveUserByToken(token);
    assert.ok(user);
    const projectId = randomUUID();
    const now = Date.now();
    saveProject({
      id: projectId,
      userId: String(user),
      repoId: 1,
      repoFullName: "octocat/scaffold-app",
      repoOwner: "octocat",
      repoName: "scaffold-app",
      defaultBranch: "main",
      htmlUrl: "https://github.invalid/octocat/scaffold-app",
      now,
    });
    selectProject(String(user), projectId, now);
    const encrypted = encryptToken("gh-token-for-scaffold-test", key);
    saveGithubConnection({
      userId: String(user),
      githubUserId: 42,
      login: "octocat",
      scopes: "public_repo workflow",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      now,
    });

    const create = async (body: Record<string, unknown>) => fetch(`${server.baseUrl}/api/projects/scaffold`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(body),
    });

    const first = await create({ appName: "My Demo App", packageName: "com.acme.demo" });
    assert.equal(first.status, 200);
    const firstBody = await first.json() as any;
    assert.equal(firstBody.packageName, "com.acme.demo");
    assert.ok(Array.isArray(firstBody.files) && firstBody.files.length >= 10);

    const filesResponse = await fetch(`${server.baseUrl}/api/projects/files`, { headers: auth });
    assert.equal(filesResponse.status, 200);
    const filesBody = await filesResponse.json() as any;
    const manifest = filesBody.files.find((file: any) => file.path === "app/src/main/AndroidManifest.xml");
    assert.ok(manifest?.content.includes("@string/app_name"));
    assert.equal(manifest?.dirty, true);

    const duplicate = await create({ appName: "My Demo App", packageName: "com.acme.demo" });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json() as any).error, "scaffold_exists");

    const replaced = await create({ appName: "Replaced App", packageName: "com.acme.demo", replace: true });
    assert.equal(replaced.status, 200);
    const stringsResponse = await fetch(`${server.baseUrl}/api/projects/files`, { headers: auth });
    const stringsBody = await stringsResponse.json() as any;
    const strings = stringsBody.files.find((file: any) => file.path === "app/src/main/res/values/strings.xml");
    assert.ok(strings?.content.includes("Replaced App"));

    const invalid = await create({ appName: "<script>bad</script>" });
    assert.equal(invalid.status, 400);
  } finally {
    await server.close();
    closeDb();
  }
});
