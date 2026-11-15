import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = new PrismaClient();
  const app = await buildApp({ env, prisma });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
