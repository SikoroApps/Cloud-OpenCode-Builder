import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.ts";
import { handleApiRequest } from "./http.ts";

console.log("cloud backend module loaded");
export async function startCloudServer(): Promise<void> {
  const config = loadConfig();
  console.log(`starting cloud backend on ${config.host}:${config.port}`);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleApiRequest(req, res).catch((error) => {
      const safeError = error as { name?: string; status?: number; kind?: string };
      console.error("request failed", {
        name: safeError?.name ?? "unknown_error",
        status: safeError?.status,
        kind: safeError?.kind,
      });
      const status = (error as any)?.name === "AiModelFallbackError" ? 503 : 500;
      if (!res.headersSent) {
        res.writeHead(status, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({
        error: status === 503 ? "ai_fallback_exhausted" : "internal_error",
        message: status === 503 ? "all configured AI models are unavailable" : "internal error",
      }));
    });
  });
  server.listen(config.port, config.host, () => {
    console.log(`Cloud OpenCode backend listening on http://${config.host}:${config.port}`);
  });
}
