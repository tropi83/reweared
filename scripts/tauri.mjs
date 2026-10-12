// `pnpm tauri …`: the Tauri CLI, with the API scope generated first for the commands that run or build the app
// (dev, build, android dev|build, ios dev|build). Other commands (icon, info, signer…) pass through unchanged.
import { spawnSync } from "node:child_process";
import { writeApiConfig } from "./tauri-api-config.mjs";

const args = process.argv.slice(2);
const mobile = args[0] === "android" || args[0] === "ios";
const command = mobile ? args[1] : args[0];
if (command === "dev" || command === "build") {
  try {
    const config = writeApiConfig();
    args.splice(mobile ? 2 : 1, 0, "--config", config);
  } catch (error) {
    console.error(`tauri: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
const result = spawnSync("tauri", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
