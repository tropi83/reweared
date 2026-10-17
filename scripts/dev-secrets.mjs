// Creates the Docker secrets the compose stack reads from ./secrets (git-ignored), with random values.
// Never overwrites an existing file: production secrets are written by hand and survive a re-run.
// Usage: node scripts/dev-secrets.mjs [directory]
//
// Permissions: Compose bind-mounts `file:` secrets with the host file's owner and mode (it ignores uid/gid/mode for
// them — docs.docker.com, compose-file "secrets"), and the containers read them as different users (node 1000,
// postgres, redis, seaweedfs). So the directory is the barrier — 0700, its owner only — and the files inside are
// 0644, readable once mounted. A re-run fixes the modes of existing files too.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "secrets";
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);

const random = (bytes) => randomBytes(bytes).toString("base64url");

function ensure(name, create) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    writeFileSync(path, `${create()}\n`, { mode: 0o644 });
    console.log(`created ${path}`);
  }
  chmodSync(path, 0o644);
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
// The platform's provider keys (worker only). Dev and CI run the Mock providers; write the real ones in production.
ensure("cloudflare_api_token", () => "placeholder-not-a-real-token");
ensure("gemini_api_key", () => "placeholder-not-a-real-key");
// Backups: the photos' crypt password; the off-site credentials are placeholders (CI and dev use a local directory as
// "off-site"). Production: write real ones, and keep the age private key offline (only the public key is configured).
ensure("backup_crypt_password", () => random(32));
ensure("backup_offsite_access_key_id", () => "placeholder");
ensure("backup_offsite_secret_access_key", () => "placeholder");
