// Creates the Docker secrets the compose stack reads from ./secrets (git-ignored), with random values.
// Never overwrites an existing file: production secrets are written by hand and survive a re-run.
// Usage: node scripts/dev-secrets.mjs [directory]
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "secrets";
mkdirSync(dir, { recursive: true });

const random = (bytes) => randomBytes(bytes).toString("base64url");

function ensure(name, create) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    writeFileSync(path, `${create()}\n`, { mode: 0o600 });
    console.log(`created ${path}`);
  }
  return readFileSync(path, "utf8").trim();
}

const postgresPassword = ensure("postgres_password", () => random(24));
ensure("database_url", () => `postgres://aiv:${postgresPassword}@postgres:5432/aiv`);
const redisPassword = ensure("redis_password", () => random(24));
ensure("redis_url", () => `redis://:${redisPassword}@redis:6379`);
const accessKey = ensure("s3_access_key_id", () => `aiv${random(9)}`);
const secretKey = ensure("s3_secret_access_key", () => random(30));
// SeaweedFS identities: the api's key is the only one, with access to its bucket.
ensure("seaweedfs_s3", () =>
  JSON.stringify({ identities: [{ name: "aiv-api", credentials: [{ accessKey, secretKey }], actions: ["Admin", "Read", "Write", "List", "Tagging"] }] }),
);
ensure("better_auth_secret", () => random(48));
// Production sends mail through Resend; dev and CI use Mailpit. Replace this placeholder with a real key in production.
ensure("resend_api_key", () => "re_placeholder_not_a_real_key");
