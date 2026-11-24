import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseDependencies, pngBytes, PNG_BASE64, registerUser, startServer } from "./phase6-8-helpers.ts";

process.env.CLOUD_DB_PATH = join(mkdtempSync(join(tmpdir(), "co-phase6-images-")), "test.sqlite");

test("authenticated users can upload, list and fetch their own images", async () => {
  const server = await startServer(baseDependencies());
  try {
    const auth = await registerUser(server.baseUrl);
    const upload = await fetch(`${server.baseUrl}/api/images`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "../evil.png",
        mimeType: "image/png",
        dataBase64: PNG_BASE64,
      }),
    });
    assert.equal(upload.status, 201);
    const uploaded = (await upload.json()) as any;
    assert.equal(uploaded.image.mimeType, "image/png");
    assert.equal(uploaded.image.sizeBytes, pngBytes().length);
    assert.equal(uploaded.image.filename, "evil.png");
    assert.equal(uploaded.image.source, "upload");
    assert.equal(uploaded.image.contentUrl, `/api/images/${uploaded.image.id}/content`);
    assert.equal(uploaded.image.sha256.length, 64);

    const list = await fetch(`${server.baseUrl}/api/images`, { headers: auth });
    assert.equal(list.status, 200);
    const listed = (await list.json()) as any;
    assert.equal(listed.images.length, 1);
    assert.equal(listed.images[0].id, uploaded.image.id);
    assert.equal("dataBase64" in listed.images[0], false);

    const content = await fetch(`${server.baseUrl}${uploaded.image.contentUrl}`, { headers: auth });
    assert.equal(content.status, 200);
    assert.equal(content.headers.get("content-type"), "image/png");
    assert.equal(content.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), pngBytes());

    const metadata = await fetch(`${server.baseUrl}/api/images/${uploaded.image.id}`, { headers: auth });
    assert.equal(metadata.status, 200);
    assert.equal(((await metadata.json()) as any).image.id, uploaded.image.id);
  } finally {
    await server.close();
  }
});

test("image upload rejects invalid bytes, spoofed MIME types and unauthenticated callers", async () => {
  const server = await startServer(baseDependencies());
  try {
    const auth = await registerUser(server.baseUrl);
    const invalid = await fetch(`${server.baseUrl}/api/images`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: "image/png", dataBase64: "!!!! not-base64 !!!!" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as any).error, "invalid_image_data");

    const spoofed = await fetch(`${server.baseUrl}/api/images`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: "image/jpeg", dataBase64: PNG_BASE64 }),
    });
    assert.equal(spoofed.status, 400);
    assert.equal(((await spoofed.json()) as any).error, "image_type_mismatch");

    const unauthenticated = await fetch(`${server.baseUrl}/api/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: "image/png", dataBase64: PNG_BASE64 }),
    });
    assert.equal(unauthenticated.status, 401);
  } finally {
    await server.close();
  }
});

test("images are scoped to their owner", async () => {
  const server = await startServer(baseDependencies());
  try {
    const owner = await registerUser(server.baseUrl);
    const other = await registerUser(server.baseUrl);
    const upload = await fetch(`${server.baseUrl}/api/images`, {
      method: "POST",
      headers: { ...owner, "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: "image/png", dataBase64: PNG_BASE64 }),
    });
    const imageId = String(((await upload.json()) as any).image.id);

    const content = await fetch(`${server.baseUrl}/api/images/${imageId}/content`, { headers: other });
    assert.equal(content.status, 404);
    const metadata = await fetch(`${server.baseUrl}/api/images/${imageId}`, { headers: other });
    assert.equal(metadata.status, 404);
    const analysis = await fetch(`${server.baseUrl}/api/images/${imageId}/analyze`, {
      method: "POST",
      headers: { ...other, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Describe" }),
    });
    assert.equal(analysis.status, 404);
  } finally {
    await server.close();
  }
});

test("image understanding uses the configured vision service and returns no credentials", async () => {
  let observed: any = null;
  const server = await startServer(baseDependencies({
    imageAnalysisService: {
      async analyze(input) {
        observed = input;
        return { model: "mock-vision/free", content: "A one-pixel test image." };
      },
    },
  }));
  try {
    const auth = await registerUser(server.baseUrl);
    const upload = await fetch(`${server.baseUrl}/api/images`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: "image/png", dataBase64: PNG_BASE64 }),
    });
    const imageId = String(((await upload.json()) as any).image.id);
    const analysis = await fetch(`${server.baseUrl}/api/images/${imageId}/analyze`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "What is in this image?" }),
    });
    assert.equal(analysis.status, 200);
    const body = (await analysis.json()) as any;
    assert.equal(body.model, "mock-vision/free");
    assert.equal(body.content, "A one-pixel test image.");
    assert.equal(observed.mimeType, "image/png");
    assert.deepEqual(observed.bytes, pngBytes());
    assert.equal(JSON.stringify(body).includes("gh-token"), false);
  } finally {
    await server.close();
  }
});

test("invalid JSON and non-numeric list limits fail safely", async () => {
  const server = await startServer(baseDependencies());
  try {
    const malformed = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: "invalid_json" });

    const auth = await registerUser(server.baseUrl);
    const images = await fetch(`${server.baseUrl}/api/images?limit=not-a-number`, { headers: auth });
    assert.equal(images.status, 200);
    assert.deepEqual(await images.json(), { images: [] });

    const tasks = await fetch(`${server.baseUrl}/api/tasks?limit=not-a-number`, { headers: auth });
    assert.equal(tasks.status, 200);
    assert.deepEqual(await tasks.json(), { tasks: [] });
  } finally {
    await server.close();
  }
});

test("image generation stores the generated image under the requesting user", async () => {
  const server = await startServer(baseDependencies({
    imageGenerationService: {
      async generate(input) {
        assert.equal(input.prompt, "a blue cloud icon");
        assert.equal(input.size, 768);
        return { bytes: pngBytes(), mimeType: "image/png" };
      },
    },
  }));
  try {
    const auth = await registerUser(server.baseUrl);
    const generated = await fetch(`${server.baseUrl}/api/images/generate`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a blue cloud icon", size: 768 }),
    });
    assert.equal(generated.status, 201);
    const body = (await generated.json()) as any;
    assert.equal(body.image.source, "generated");
    assert.equal(body.image.prompt, "a blue cloud icon");
    assert.equal(body.image.mimeType, "image/png");

    const invalidSize = await fetch(`${server.baseUrl}/api/images/generate`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a blue cloud icon", size: 123 }),
    });
    assert.equal(invalidSize.status, 400);
    assert.equal(((await invalidSize.json()) as any).error, "invalid_image_size");
  } finally {
    await server.close();
  }
});
