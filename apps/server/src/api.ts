import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { pino, type Logger } from "pino";
import { buildApp } from "./app";
import { createAuth } from "./auth/auth";
import { createMailer } from "./auth/create-mailer";
import { ConfigError, loadConfig } from "./config";
import { connectDatabase } from "./db/client";
import { describeError, loggerOptions } from "./log";
import { deleteUserObjects } from "./me/account-cleanup";
import { connectRedis } from "./redis";
import { NeuronBudget } from "./queue/budget";
import { Dispatcher } from "./queue/dispatcher";
import { QueueSet, createQueueConnection } from "./queue/queues";
import { assertWorkerAlive } from "./worker/liveness";
import { assertPlatformCopyModel, platformImageModel } from "./providers/catalogue";
import { S3ObjectStore } from "./storage/s3-object-store";

/** First start of a self-hosted store: create the bucket (idempotent). The store may still be starting, so retry. */
async function ensureBucketWithRetry(store: S3ObjectStore, log: Logger): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await store.ensureBucket();
      return;
    } catch (error) {
      if (attempt >= 30) throw error;
      log.warn({ err: error, attempt }, "object store not ready, retrying");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, (path) => readFileSync(path, "utf8"));
  const log = pino(loggerOptions(config.LOG_LEVEL));
  const database = connectDatabase(config.DATABASE_URL);
  const redis = connectRedis(config.REDIS_URL);
  const store = new S3ObjectStore({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  });
  await ensureBucketWithRetry(store, log);
  const google =
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET } : undefined;
  const auth = createAuth(
    { publicOrigin: config.PUBLIC_ORIGIN, appOrigins: config.CORS_ORIGINS, secret: config.BETTER_AUTH_SECRET, google },
    { db: database.db, redis, mailer: createMailer(config), log, afterUserDeleted: deleteUserObjects(store, log) },
  );
  const queueConnection = createQueueConnection(config.REDIS_URL);
  const queues = new QueueSet({ connection: queueConnection, attempts: config.JOB_ATTEMPTS });
  const dispatcher = new Dispatcher({ db: database.db, redis: queueConnection, queues, maxActivePerUser: config.MAX_ACTIVE_JOBS_PER_USER, log });
  assertPlatformCopyModel(config.COPY_PROVIDER, config.COPY_MODEL);
  const platform = {
    imageProvider: config.IMAGE_PROVIDER,
    imageModel: platformImageModel(config.IMAGE_PROVIDER, config.IMAGE_MODEL),
    copyProvider: config.COPY_PROVIDER,
    copyModelId: config.COPY_MODEL,
  };
  const app = await buildApp({
    logger: log,
    appOrigins: config.CORS_ORIGINS,
    readiness: [
      { name: "database", check: async () => void (await database.db.execute(sql`select 1`)) },
      { name: "redis", check: async () => void (await redis.ping()) },
      { name: "storage", check: () => store.ping() },
      // The api never runs jobs: without a live worker the queue silently fills, which only this check shows from outside.
      { name: "worker", check: () => assertWorkerAlive(redis, Date.now()) },
    ],
    accounts: {
      auth,
      publicOrigin: config.PUBLIC_ORIGIN,
      redis,
      db: database.db,
      store,
      maxUploadBytes: config.MAX_UPLOAD_BYTES,
      freeMonthlyCredits: config.FREE_MONTHLY_CREDITS,
    },
    runs: {
      db: database.db,
      redis: queueConnection,
      queues,
      dispatcher,
      budget: new NeuronBudget(queueConnection, config.CLOUDFLARE_DAILY_NEURON_BUDGET),
      platform,
      freeMonthlyCredits: config.FREE_MONTHLY_CREDITS,
    },
  });

  const shutdown = (signal: string) => {
    app.log.info({ signal }, "shutting down");
    app
      .close()
      .then(() => Promise.allSettled([database.close(), redis.quit(), queues.close().then(() => queueConnection.quit()), Promise.resolve(store.close())]))
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
