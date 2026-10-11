import { defineConfig } from "drizzle-kit";

// `pnpm --filter @aiv/server db:generate` writes SQL migrations into ./drizzle from the schema; they are
// committed and never edited afterwards (forward-only). No database connection is needed to generate.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
