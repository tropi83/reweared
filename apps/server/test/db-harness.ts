import { sql } from "drizzle-orm";
import { inject } from "vitest";
import { connectDatabase, type Database } from "../src/db/client";

/** Our tables and Better Auth's, emptied between tests (user first: everything else cascades from it). */
const TABLES = [
  "user",
  "verification",
  "listing",
  "image_asset",
  "user_settings",
  "recipe",
  "session",
  "account",
  "generation",
  "generation_job",
  "credit_ledger",
  "credit_balance",
];

export function openTestDatabase(): Database {
  return connectDatabase(inject("databaseUrl"), { max: 4 });
}

export async function truncateAll(database: Database): Promise<void> {
  await database.db.execute(sql.raw(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));
}
