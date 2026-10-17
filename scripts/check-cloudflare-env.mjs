// Before `pnpm stack:up:cloudflare`: says what is missing instead of letting the worker crash-loop on a config error.
// Reads .env and ./secrets/cloudflare_api_token; prints names and verdicts only, never a value.
import { existsSync, readFileSync } from "node:fs";

const problems = [];
const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const account = /^CLOUDFLARE_ACCOUNT_ID=(.*)$/m.exec(env)?.[1]?.trim() ?? "";
if (!/^[a-f0-9]{32}$/.test(account))
  problems.push("CLOUDFLARE_ACCOUNT_ID in .env must be your 32-character hexadecimal account id (Cloudflare dashboard → Workers AI).");
const token = existsSync("secrets/cloudflare_api_token") ? readFileSync("secrets/cloudflare_api_token", "utf8").trim() : "";
if (token === "" || token.startsWith("placeholder"))
  problems.push("secrets/cloudflare_api_token still holds the placeholder: write your Cloudflare API token (Workers AI permission) in it.");

if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log("cloudflare: account id and token are set");
