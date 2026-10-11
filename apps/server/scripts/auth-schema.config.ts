// Configuration read only by `pnpm --filter @aiv/server auth:schema` (Better Auth's `auth generate`) to emit
// src/db/auth-schema.ts. Keep its options and plugins in step with src/auth/auth.ts: they decide the tables.
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";

// Better Auth sends telemetry when BETTER_AUTH_TELEMETRY is truthy OR telemetry.enabled is true; force both off.
process.env.BETTER_AUTH_TELEMETRY = "0";

export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  plugins: [bearer()],
  telemetry: { enabled: false },
});
