import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function connectDatabase(url: string, options: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  // An idle client error must not crash the process; the next query reports the problem.
  pool.on("error", () => undefined);
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** Applies the committed migrations in `folder` (forward-only). */
export async function runMigrations(db: Db, folder: string): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
