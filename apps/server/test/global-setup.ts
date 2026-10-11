import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { TestProject } from "vitest/node";
import { connectDatabase, runMigrations } from "../src/db/client";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

/**
 * Starts the containers once per integration run and applies the committed migrations, exactly as the
 * `migrate` service does in compose. Test files get the URLs through `inject()`.
 */
export async function setup(project: TestProject): Promise<void> {
  [postgres, redis] = await Promise.all([new PostgreSqlContainer("postgres:17-alpine").start(), new RedisContainer("redis:7-alpine").start()]);
  const databaseUrl = postgres.getConnectionUri();
  const database = connectDatabase(databaseUrl, { max: 1 });
  try {
    await runMigrations(database.db, fileURLToPath(new URL("../drizzle", import.meta.url)));
  } finally {
    await database.close();
  }
  project.provide("databaseUrl", databaseUrl);
  project.provide("redisUrl", redis.getConnectionUrl());
}

export async function teardown(): Promise<void> {
  await Promise.all([postgres?.stop(), redis?.stop()]);
}
