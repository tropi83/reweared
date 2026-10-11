import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { buildApp } from "./app";
import { createAuth } from "./auth/auth";
import { MemoryMailer, ResendMailer, SmtpMailer, type Mailer } from "./auth/mailer";
import { ConfigError, loadConfig, type ServerConfig } from "./config";
import { connectDatabase } from "./db/client";
import { describeError, loggerOptions } from "./log";
import { connectRedis } from "./redis";

function createMailer(config: ServerConfig): Mailer {
  if (config.MAIL_MODE === "resend") return new ResendMailer(config.RESEND_API_KEY ?? "", config.MAIL_FROM);
  if (config.MAIL_MODE === "smtp") return new SmtpMailer(config.SMTP_URL ?? "", config.MAIL_FROM);
  return new MemoryMailer();
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, (path) => readFileSync(path, "utf8"));
  const log = pino(loggerOptions(config.LOG_LEVEL));
  const database = connectDatabase(config.DATABASE_URL);
  const redis = connectRedis(config.REDIS_URL);
  const google =
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET } : undefined;
  const auth = createAuth(
    { publicOrigin: config.PUBLIC_ORIGIN, secret: config.BETTER_AUTH_SECRET, google },
    { db: database.db, redis, mailer: createMailer(config), log },
  );
  const app = await buildApp({
    logger: log,
    readiness: [
      { name: "database", check: async () => void (await database.db.execute(sql`select 1`)) },
      { name: "redis", check: async () => void (await redis.ping()) },
    ],
    accounts: { auth, publicOrigin: config.PUBLIC_ORIGIN, redis },
  });

  const shutdown = (signal: string) => {
    app.log.info({ signal }, "shutting down");
    app
      .close()
      .then(() => Promise.allSettled([database.close(), redis.quit()]))
      .then(
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
  console.error(error instanceof ConfigError ? error.message : describeError(error));
  process.exit(1);
});
