import { readFileSync } from "node:fs";
import { redact } from "@aiv/domain/lib/redact";
import { buildApp } from "./app";
import { ConfigError, loadConfig } from "./config";
import { loggerOptions } from "./log";

async function main(): Promise<void> {
  const config = loadConfig(process.env, (path) => readFileSync(path, "utf8"));
  const app = buildApp({ logger: loggerOptions(config.LOG_LEVEL), readiness: [] });

  const shutdown = (signal: string) => {
    app.log.info({ signal }, "shutting down");
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: config.PORT });
}

main().catch((error: unknown) => {
  // Config errors name the variables, never their values; anything else goes through the shared redaction.
  console.error(error instanceof ConfigError ? error.message : redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
  process.exit(1);
});
