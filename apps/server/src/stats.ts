import { readFileSync } from "node:fs";
import { loadConfig } from "./config";
import { connectDatabase } from "./db/client";
import { collectStats } from "./ops/stats";
import { connectRedis } from "./redis";

/** `docker compose exec api node dist/stats.js`: the owner's counters, as JSON on stdout. No admin web surface. */
async function main(): Promise<void> {
  const config = loadConfig(process.env, (path) => readFileSync(path, "utf8"));
  const database = connectDatabase(config.DATABASE_URL);
  const redis = connectRedis(config.REDIS_URL);
  try {
    console.log(JSON.stringify(await collectStats(database.db, redis), null, 2));
  } finally {
    redis.disconnect();
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "stats failed");
  process.exit(1);
});
