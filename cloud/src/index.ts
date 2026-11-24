import { startCloudServer } from "./server.ts";

async function main(): Promise<void> {
  const { startCloudServer: start } = await import("./server.ts");
  await start();
}

main();
