import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.ts";
import { handleApiRequest } from "./http.ts";

console.log("cloud backend module loaded");
export async function startCloudServer(): Promise<void> {
  const config = loadConfig();
  console.log(`starting cloud backend on ${config.host}:${config.port}`);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleApiRequest(req, res).catch((error) => {
      console.error("request failed", error);
      const status = (error as any)?.name === "AiModelFallbackError" ? 503 : 500;
      if (!res.headersSent) {
        res.writeHead(status, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: status === 503 ? "ai_fallback_exhausted" : "internal_error", message: error instanceof Error ? error.message : "unknown" }));
    });
  });
  server.listen(config.port, config.host, () => {
    console.log(`Cloud OpenCode backend listening on http://${config.host}:${config.port}`);
  });
}
