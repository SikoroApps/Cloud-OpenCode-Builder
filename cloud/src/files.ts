import { runAiFallback } from "./ai.ts";

export interface AiFileOperation {
  path: string;
  content: string;
}

export interface AiFilePlan {
  model: string;
  operations: AiFileOperation[];
}

export type AiFilePlanner = (input: { instruction: string; files: { path: string; content: string }[] }) => Promise<AiFilePlan>;

const ALLOWED_EXTENSIONS = [
  ".kt", ".kts", ".xml", ".gradle", ".properties", ".md", ".json", ".gitignore", ".txt", ".yml", ".yaml",
];
const MAX_FILE_BYTES = 200_000;

export function validateFilePath(rawPath: string): string {
  const path = String(rawPath || "").trim().replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\\") || path.length > 300) {
    throw new Error("invalid_file_path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment.startsWith(".") && segment !== ".gitignore")) {
    throw new Error("invalid_file_path");
  }
  const lower = path.toLowerCase();
  if (lower !== ".gitignore" && !ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    throw new Error("unsupported_file_type");
  }
  return path;
}

export function validateFileContent(content: string): string {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new Error("invalid_file_content");
  }
  return content;
}

export function parseAiFilePlan(raw: string): AiFileOperation[] {
  const withoutFences = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("invalid_ai_file_plan");
  const parsed = JSON.parse(withoutFences.slice(start, end + 1)) as any;
  const operations = Array.isArray(parsed?.operations) ? parsed.operations : [];
  if (!operations.length) throw new Error("invalid_ai_file_plan");
  return operations.map((operation: any) => ({
    path: validateFilePath(String(operation?.path || "")),
    content: validateFileContent(String(operation?.content ?? "")),
  }));
}

export function createDefaultAiFilePlanner(): AiFilePlanner {
  return async ({ instruction, files }) => {
    const fileSummary = files.map((file) => `${file.path}\n${file.content}`).join("\n\n---\n\n");
    const prompt = [
      "You edit Android project files. Return ONLY a JSON object of the form",
      '{"operations":[{"path":"app/src/main/...","content":"full file contents"}]}.',
      "Do not include commentary or markdown.",
      "Current files:",
      fileSummary || "(none)",
      "Instruction:",
      instruction,
    ].join("\n");
    const result = await runAiFallback({
      messages: [
        { role: "system", content: "You are a precise JSON-only project file editor." },
        { role: "user", content: prompt },
      ],
    });
    return { model: result.model, operations: parseAiFilePlan(result.content) };
  };
}
