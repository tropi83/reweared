import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import type { TestProject } from "vitest/node";
import { connectDatabase, runMigrations } from "../src/db/client";
import { S3ObjectStore, type S3StoreConfig } from "../src/storage/s3-object-store";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
    s3: S3StoreConfig;
  }
}

/** Same image as compose.yaml; release 4.48 (2026-09-28). MinIO is not used: its Community Edition is unmaintained. */
const SEAWEEDFS_IMAGE = "chrislusf/seaweedfs:4.48";
const S3_ACCESS_KEY = "integration-test";
const S3_SECRET_KEY = "integration-test-secret-0123456789";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let seaweedfs: StartedTestContainer | undefined;

function startSeaweedfs(): Promise<StartedTestContainer> {
  const identities = {
    identities: [
      { name: "aiv", credentials: [{ accessKey: S3_ACCESS_KEY, secretKey: S3_SECRET_KEY }], actions: ["Admin", "Read", "Write", "List", "Tagging"] },
    ],
  };
  return (
    new GenericContainer(SEAWEEDFS_IMAGE)
      .withCopyContentToContainer([{ content: JSON.stringify(identities), target: "/etc/seaweedfs/s3.json" }])
      .withCommand(["server", "-dir=/data", "-s3", "-s3.port=8333", "-s3.config=/etc/seaweedfs/s3.json"])
      .withExposedPorts(8333)
      // An anonymous request answers 403 once the S3 gateway is up with authentication on.
      .withWaitStrategy(Wait.forHttp("/", 8333).forStatusCode(403))
      .withStartupTimeout(120_000)
      .start()
  );
}

/** The gateway answers before the master has elected itself; retry the bucket creation for a few seconds. */
async function createBucket(config: S3StoreConfig): Promise<void> {
  const store = new S3ObjectStore(config);
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await store.ensureBucket();
        return;
      } catch (error) {
        if (attempt >= 30) throw error;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } finally {
    store.close();
  }
}

/**
 * Starts the containers once per integration run, applies the committed migrations (as the compose `migrate`
 * service does) and creates the bucket. Test files get the connection details through `inject()`.
 */
export async function setup(project: TestProject): Promise<void> {
  [postgres, redis, seaweedfs] = await Promise.all([
    new PostgreSqlContainer("postgres:17-alpine").start(),
    new RedisContainer("redis:7-alpine").start(),
    startSeaweedfs(),
  ]);
  const databaseUrl = postgres.getConnectionUri();
  const database = connectDatabase(databaseUrl, { max: 1 });
  try {
    await runMigrations(database.db, fileURLToPath(new URL("../drizzle", import.meta.url)));
  } finally {
    await database.close();
  }
  const s3: S3StoreConfig = {
    endpoint: `http://${seaweedfs.getHost()}:${seaweedfs.getMappedPort(8333)}`,
    region: "us-east-1",
    bucket: "aiv-integration",
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  };
  await createBucket(s3);
  project.provide("databaseUrl", databaseUrl);
  project.provide("redisUrl", redis.getConnectionUrl());
  project.provide("s3", s3);
}

export async function teardown(): Promise<void> {
  await Promise.all([postgres?.stop(), redis?.stop(), seaweedfs?.stop()]);
}
