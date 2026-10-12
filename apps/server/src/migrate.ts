import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connectDatabase, runMigrations } from "./db/client";
import { describeError } from "./log";

/**
 * One-shot entrypoint (`node dist/migrate.js`, the compose `migrate` service): applies the committed SQL
 * migrations, then exits. Only the database URL is needed, so it does not load the API configuration.
 */
async function main(): Promise<void> {
  const file = process.env.DATABASE_URL_FILE;
  const url = file ? readFileSync(file, "utf8").replace(/\r?\n$/, "") : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL or DATABASE_URL_FILE is required");
  const folder = process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../drizzle", import.meta.url));
  const database = connectDatabase(url, { max: 1 });
  try {
    await runMigrations(database.db, folder);
    console.info("migrations applied");
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exit(1);
});
