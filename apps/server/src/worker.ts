import { readFileSync } from "node:fs";
import { pino } from "pino";
import { ConfigError } from "./config";
import { connectDatabase } from "./db/client";
import { describeError, loggerOptions } from "./log";
import { assertPlatformCopyModel, platformImageModel } from "./providers/catalogue";
import { NeuronBudget } from "./queue/budget";
import { Dispatcher } from "./queue/dispatcher";
import { RedisEventPublisher } from "./queue/events";
import { QueueSet, createQueueConnection } from "./queue/queues";
import { S3ObjectStore } from "./storage/s3-object-store";
import { loadWorkerConfig } from "./worker/config";
import { buildProviders } from "./worker/registry";
import { startWorkers } from "./worker/workers";

/** The generation worker (`node dist/worker.js`): the only process with the platform's provider keys. */
async function main(): Promise<void> {
  const config = loadWorkerConfig(process.env, (path) => readFileSync(path, "utf8"));
  const log = pino(loggerOptions(config.LOG_LEVEL));
  assertPlatformCopyModel(config.COPY_PROVIDER, config.COPY_MODEL);
  const imageModel = platformImageModel(config.IMAGE_PROVIDER, config.IMAGE_MODEL);
  const database = connectDatabase(config.DATABASE_URL);
  const connection = createQueueConnection(config.REDIS_URL);
  const queues = new QueueSet({ connection, attempts: config.JOB_ATTEMPTS });
  const store = new S3ObjectStore({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  });
  const dispatcher = new Dispatcher({ db: database.db, redis: connection, queues, maxActivePerUser: config.MAX_ACTIVE_JOBS_PER_USER, log });
  const workers = await startWorkers(
    {
      db: database.db,
      redis: connection,
      store,
      providers: buildProviders(config, log),
      imageProvider: config.IMAGE_PROVIDER,
      imageModel,
      copyModelId: config.COPY_MODEL,
      attempts: config.JOB_ATTEMPTS,
      timeoutMs: config.JOB_TIMEOUT_MS,
      dispatcher,
      budget: new NeuronBudget(connection, config.CLOUDFLARE_DAILY_NEURON_BUDGET),
      events: new RedisEventPublisher(connection),
      log,
    },
    {
      connection,
      queues,
      copyProvider: config.COPY_PROVIDER,
      concurrency: config.WORKER_CONCURRENCY,
      maxPerMinute: {
        image: config.IMAGE_PROVIDER === "gemini" ? config.GEMINI_MAX_PER_MINUTE : config.CLOUDFLARE_MAX_PER_MINUTE,
        copy: config.COPY_PROVIDER === "cloudflare" ? config.CLOUDFLARE_MAX_PER_MINUTE : config.GEMINI_MAX_PER_MINUTE,
      },
    },
  );
  log.info({ imageProvider: config.IMAGE_PROVIDER, copyProvider: config.COPY_PROVIDER }, "worker started");

  const shutdown = (signal: string) => {
    log.info({ signal }, "worker shutting down: finishing active jobs");
    workers
      .close()
      .then(() => Promise.allSettled([queues.close(), database.close()]))
      .then(() => connection.quit())
      .then(
        () => process.exit(0),
        () => process.exit(1),
      );
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? error.message : describeError(error));
  process.exit(1);
});
