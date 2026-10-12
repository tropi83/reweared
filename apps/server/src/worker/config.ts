import { z } from "zod";
import { ConfigError } from "../config";

/**
 * The worker's configuration: the only process that holds the platform's provider keys (Docker secrets read
 * from `*_FILE`). It has no auth secret, no mail key and no public origin — it never serves a client.
 */
const SECRET_KEYS = ["DATABASE_URL", "REDIS_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "CLOUDFLARE_API_TOKEN", "GEMINI_API_KEY"] as const;

const workerSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  IMAGE_PROVIDER: z.enum(["cloudflare", "gemini", "mock"]).default("cloudflare"),
  IMAGE_MODEL: z.string().min(1).default("@cf/black-forest-labs/flux-2-klein-4b"),
  COPY_PROVIDER: z.enum(["gemini", "cloudflare", "mock"]).default("gemini"),
  COPY_MODEL: z.string().min(1).default("gemini-3.1-flash-lite"),
  ENABLE_MOCK_PROVIDER: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CLOUDFLARE_ACCOUNT_ID: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  MAX_ACTIVE_JOBS_PER_USER: z.coerce.number().int().min(1).max(20).default(4),
  JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  JOB_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(120_000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  CLOUDFLARE_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  GEMINI_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(15),
  CLOUDFLARE_DAILY_NEURON_BUDGET: z.coerce.number().int().nonnegative().default(9000),
});

export type WorkerConfig = z.infer<typeof workerSchema>;

function crossFieldProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const uses = (p: string) =>
    env.IMAGE_PROVIDER === p || env.COPY_PROVIDER === p || (p === "cloudflare" && !env.IMAGE_PROVIDER) || (p === "gemini" && !env.COPY_PROVIDER);
  if (uses("cloudflare") && (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN))
    problems.push("CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN: required by the Cloudflare provider");
  if (uses("gemini") && !env.GEMINI_API_KEY) problems.push("GEMINI_API_KEY: required by the Gemini provider");
  const mock = env.IMAGE_PROVIDER === "mock" || env.COPY_PROVIDER === "mock";
  if (mock && env.ENABLE_MOCK_PROVIDER !== "true") problems.push("IMAGE_PROVIDER/COPY_PROVIDER: mock needs ENABLE_MOCK_PROVIDER=true");
  if (env.ENABLE_MOCK_PROVIDER === "true" && (env.NODE_ENV ?? "production") === "production") problems.push("ENABLE_MOCK_PROVIDER: not allowed in production");
  return problems;
}

/** Same rules as the api's loader: `X_FILE` wins over `X`, every problem named once, never a value. */
export function loadWorkerConfig(env: Record<string, string | undefined>, readFile: (path: string) => string): WorkerConfig {
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
  const parsed = workerSchema.safeParse(resolved);
  if (!parsed.success) for (const issue of parsed.error.issues) problems.push(`${issue.path.join(".") || "config"}: ${issue.message}`);
  if (problems.length > 0 || !parsed.success) throw new ConfigError(problems);
  return parsed.data;
}
