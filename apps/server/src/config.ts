import { z } from "zod";

/**
 * Server configuration from the environment. Secrets are read from files (`X_FILE`, Docker secrets mounted
 * under /run/secrets) and only fall back to a plain `X` variable for tests and local scripts. Error messages
 * name the variable, never its value.
 */
const SECRET_KEYS = ["DATABASE_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "BETTER_AUTH_SECRET", "RESEND_API_KEY", "GOOGLE_CLIENT_SECRET"] as const;

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PUBLIC_ORIGIN: z.url({ protocol: /^https?$/ }),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  MAIL_MODE: z.enum(["resend", "smtp", "memory"]).default("resend"),
  MAIL_FROM: z.string().min(3),
  RESEND_API_KEY: z.string().min(1).optional(),
  SMTP_URL: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(40 * 1024 * 1024),
});

/** Rules across variables, checked even when other variables are invalid so every problem is reported at once. */
function crossFieldProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const mode = env.MAIL_MODE ?? "resend";
  if (mode === "resend" && !env.RESEND_API_KEY) problems.push("RESEND_API_KEY: required when MAIL_MODE=resend");
  if (mode === "smtp" && !env.SMTP_URL) problems.push("SMTP_URL: required when MAIL_MODE=smtp");
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET))
    problems.push("GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together");
  return problems;
}

export type ServerConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid server configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/**
 * Pure: `env` is `process.env`, `readFile` reads a secret file (trailing newline trimmed). A `X_FILE`
 * variable wins over `X`.
 */
export function loadConfig(env: Record<string, string | undefined>, readFile: (path: string) => string): ServerConfig {
  const resolved: Record<string, string | undefined> = { ...env };
  const problems: string[] = [];
  for (const key of SECRET_KEYS) {
    const file = env[`${key}_FILE`];
    if (!file) continue;
    try {
      resolved[key] = readFile(file).replace(/\r?\n$/, "");
    } catch {
      problems.push(`${key}_FILE: cannot read the secret file`);
    }
  }
  for (const [key, value] of Object.entries(resolved)) if (value === "") resolved[key] = undefined;
  problems.push(...crossFieldProblems(resolved));
  const parsed = configSchema.safeParse(resolved);
  if (!parsed.success) for (const issue of parsed.error.issues) problems.push(`${issue.path.join(".") || "config"}: ${issue.message}`);
  if (problems.length > 0 || !parsed.success) throw new ConfigError(problems);
  return parsed.data;
}
