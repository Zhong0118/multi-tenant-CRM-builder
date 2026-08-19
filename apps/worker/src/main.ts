import { config as loadEnv } from "dotenv";
import { Redis } from "ioredis";
import { fileURLToPath } from "node:url";
import pino from "pino";

import { loadWorkerConfig } from "./config/index.js";

const logger = pino({ name: "crm-worker" });

loadEnv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

async function start() {
  const config = loadWorkerConfig(process.env);
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  let stopping = false;

  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "stopping worker");
    await redis.quit();
    logger.info("worker stopped");
  };

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  await redis.connect();
  logger.info("worker runtime ready; no business queues are registered");
}

void start().catch((error: unknown) => {
  logger.error({ error }, "worker failed to start");
  process.exitCode = 1;
});
