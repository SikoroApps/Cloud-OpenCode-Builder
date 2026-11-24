import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const IMAGE_GENERATION_SIZES = [512, 768, 1024] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export type ImageGenerationSize = (typeof IMAGE_GENERATION_SIZES)[number];

export interface ValidatedImage {
  bytes: Buffer;
  mimeType: AllowedImageMimeType;
  filename: string;
  sizeBytes: number;
  sha256: string;
  dataBase64: string;
}

export interface ImageAnalysisInput {
  bytes: Buffer;
  mimeType: string;
  prompt: string;
}

export interface ImageAnalysisResult {
  model: string;
  content: string;
}

export interface ImageAnalysisService {
  analyze(input: ImageAnalysisInput): Promise<ImageAnalysisResult>;
}

export interface ImageGenerationInput {
  prompt: string;
  size: ImageGenerationSize;
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: AllowedImageMimeType;
}

export interface ImageGenerationService {
  generate(input: ImageGenerationInput): Promise<GeneratedImage>;
}

export interface WebImageFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export class ImageServiceError extends Error {
  status: number;
  code: string;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "ImageServiceError";
    this.code = code;
    this.status = status;
  }
}

export function validateImageUpload(input: {
  dataBase64: unknown;
  mimeType: unknown;
  filename?: unknown;
}): ValidatedImage {
  const raw = String(input.dataBase64 || "").trim();
  if (!raw) throw new ImageServiceError("invalid_image_data");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw new ImageServiceError("invalid_image_data");
  const normalized = raw.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(normalized, "base64");
  } catch {
    throw new ImageServiceError("invalid_image_data");
  }
  if (!bytes.length) throw new ImageServiceError("invalid_image_data");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageServiceError("image_too_large");

  const detected = detectImageMimeType(bytes);
  if (!detected) throw new ImageServiceError("unsupported_image_type");
  const declared = String(input.mimeType || "").toLowerCase().split(";")[0].trim();
  if (declared && declared !== detected) throw new ImageServiceError("image_type_mismatch");

  const dataBase64 = bytes.toString("base64");
  return {
    bytes,
    mimeType: detected,
    filename: sanitizeImageFilename(input.filename, detected),
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dataBase64,
  };
}

export function detectImageMimeType(bytes: Buffer): AllowedImageMimeType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6) {
    const signature = bytes.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12) {
    const riff = bytes.subarray(0, 4).toString("ascii");
    const webp = bytes.subarray(8, 12).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  return null;
}

export function sanitizeImageFilename(raw: unknown, mimeType: AllowedImageMimeType): string {
  const fallbackExtension = mimeType.split("/")[1] === "jpeg" ? "jpg" : mimeType.split("/")[1];
  const base = String(raw || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 100);
  if (!base || base === "." || base === "..") return `image.${fallbackExtension}`;
  return base.includes(".") ? base : `${base}.${fallbackExtension}`;
}

export function imageDataUrl(image: { mimeType: string; dataBase64: string }): string {
  return `data:${image.mimeType};base64,${image.dataBase64}`;
}

export function createImageAnalysisService(options: {
  fetchImpl?: WebImageFetch;
  openRouterApiKey?: string;
  model?: string;
  stub?: boolean;
} = {}): ImageAnalysisService {
  const fetchImpl = options.fetchImpl ?? fetch;
  const openRouterApiKey = options.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? "";
  const model = options.model ?? process.env.IMAGE_UNDERSTANDING_MODEL ?? "google/gemma-3-27b-it:free";
  const stub = options.stub ?? process.env.CLOUD_AI_STUB === "1";

  return {
    async analyze({ bytes, mimeType, prompt }) {
      const instruction = prompt.trim();
      if (!instruction) throw new ImageServiceError("invalid_request");
      if (instruction.length > 4000) throw new ImageServiceError("invalid_request");
      if (stub) {
        return { model: "stub/local-test", content: `STUB_IMAGE:${instruction}` };
      }
      if (!openRouterApiKey) throw new ImageServiceError("image_understanding_not_configured", 503);

      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: instruction },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${bytes.toString("base64")}` } },
            ],
          }],
          max_tokens: 1024,
        }),
      }).catch(() => null);
      if (!response || !response.ok) {
        throw new ImageServiceError("image_understanding_failed", 502);
      }
      const body = await response.json().catch(() => ({})) as any;
      const content = String(body?.choices?.[0]?.message?.content ?? "").trim();
      if (!content) throw new ImageServiceError("image_understanding_failed", 502);
      return { model: String(body?.model || model), content };
    },
  };
}

export function createImageGenerationService(options: {
  fetchImpl?: WebImageFetch;
  baseUrl?: string;
  stub?: boolean;
} = {}): ImageGenerationService {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? process.env.IMAGE_GENERATION_URL ?? "https://image.pollinations.ai/prompt")
    .replace(/\/+$/, "");
  const stub = options.stub ?? process.env.CLOUD_IMAGE_GENERATION_STUB === "1";

  return {
    async generate({ prompt, size }) {
      const instruction = prompt.trim();
      if (!instruction) throw new ImageServiceError("invalid_request");
      if (instruction.length > 2000) throw new ImageServiceError("invalid_request");
      if (!(IMAGE_GENERATION_SIZES as readonly number[]).includes(size)) {
        throw new ImageServiceError("invalid_image_size");
      }
      if (stub) {
        return { bytes: stubPng(), mimeType: "image/png" };
      }

      const url = `${baseUrl}/${encodeURIComponent(instruction)}?width=${size}&height=${size}&nologo=true&safe=true`;
      const response = await fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(60_000),
        headers: { Accept: "image/png,image/jpeg,image/webp" },
      }).catch(() => null);
      if (!response || !response.ok) throw new ImageServiceError("image_generation_failed", 502);
      const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (contentType && !contentType.startsWith("image/")) {
        throw new ImageServiceError("image_generation_failed", 502);
      }
      const declared = ALLOWED_IMAGE_MIME_TYPES.includes(contentType as AllowedImageMimeType)
        ? contentType as AllowedImageMimeType
        : null;
      let buffer: Buffer;
      try {
        buffer = Buffer.from(await response.arrayBuffer());
      } catch {
        throw new ImageServiceError("image_generation_failed", 502);
      }
      if (!buffer.length) throw new ImageServiceError("image_generation_failed", 502);
      if (buffer.length > MAX_GENERATED_IMAGE_BYTES) throw new ImageServiceError("image_generation_failed", 502);
      const detected = detectImageMimeType(buffer);
      if (!detected) throw new ImageServiceError("image_generation_failed", 502);
      if (declared && declared !== detected) throw new ImageServiceError("image_generation_failed", 502);
      return { bytes: buffer, mimeType: detected };
    },
  };
}

function stubPng(): Buffer {
  // 1x1 transparent PNG, used only when explicitly enabled by CLOUD_IMAGE_GENERATION_STUB for tests/CI.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
}
