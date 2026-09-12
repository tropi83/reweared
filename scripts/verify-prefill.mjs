// Freshness guard: the committed Vinted pre-fill bundle must match its sources.
// Rebuilds it, then fails if the working tree differs from the index (works on every shell, incl. Windows).
import { execSync } from "node:child_process";

const BUNDLE = "src-tauri/scripts/vinted-prefill.js";
const opts = { stdio: "inherit" };

execSync("pnpm build:prefill", opts);
try {
  execSync(`git ls-files --error-unmatch -- ${BUNDLE}`, { stdio: "ignore" });
  execSync(`git diff --quiet -- ${BUNDLE}`, { stdio: "ignore" });
} catch {
  console.error(`${BUNDLE} is stale: run pnpm build:prefill and commit`);
  process.exit(1);
}
console.log(`${BUNDLE} is up to date`);
