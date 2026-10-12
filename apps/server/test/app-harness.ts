import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { inject } from "vitest";
import { buildApp } from "../src/app";
import { createAuth, type Auth } from "../src/auth/auth";
import { requireUser } from "../src/http/auth-guard";
import { MemoryMailer } from "../src/auth/mailer";
import type { Database } from "../src/db/client";
import { deleteUserObjects } from "../src/me/account-cleanup";
import { connectRedis } from "../src/redis";
import { S3ObjectStore } from "../src/storage/s3-object-store";
import { NeuronBudget } from "../src/queue/budget";
import { Dispatcher } from "../src/queue/dispatcher";
import { QueueSet, createQueueConnection } from "../src/queue/queues";
import { MOCK_COPY_MODEL_ID, MOCK_IMAGE_MODEL } from "../src/providers/catalogue";
import type { RunDeps } from "../src/generations/runs";
import { openTestDatabase, truncateAll } from "./db-harness";

export const PASSWORD = "correct horse battery";

export interface Harness {
  app: FastifyInstance;
  auth: Auth;
  mailer: MemoryMailer;
  database: Database;
  store: S3ObjectStore;
  runs: RunDeps;
  origin: string;
  close(): Promise<void>;
  reset(): Promise<void>;
}

/** The real API (Better Auth, Postgres, Redis) with an in-memory mailbox, driven through `app.inject()`. */
export async function startHarness(origin = "http://app.test"): Promise<Harness> {
  const database = openTestDatabase();
  const redis = connectRedis(inject("redisUrl"));
  const mailer = new MemoryMailer();
  const store = new S3ObjectStore(inject("s3"));
  const silent = { level: "silent", fatal() {}, error() {}, warn() {}, info() {}, debug() {}, trace() {}, silent() {}, child: () => silent } as never;
  const auth = createAuth(
    { publicOrigin: origin, secret: "test-secret-0123456789-0123456789-abcdef" },
    { db: database.db, redis, mailer, log: silent, afterUserDeleted: deleteUserObjects(store, silent) },
  );
  const queueConnection = createQueueConnection(inject("redisUrl"));
  const queues = new QueueSet({ connection: queueConnection, attempts: 3, prefix: "test-api" });
  const runs: RunDeps = {
    db: database.db,
    redis: queueConnection,
    queues,
    dispatcher: new Dispatcher({ db: database.db, redis: queueConnection, queues, maxActivePerUser: 4, log: silent }),
    budget: new NeuronBudget(queueConnection, 9000),
    platform: { imageProvider: "mock", imageModel: MOCK_IMAGE_MODEL, copyProvider: "mock", copyModelId: MOCK_COPY_MODEL_ID },
    freeMonthlyCredits: 60,
  };
  const app = await buildApp({
    logger: false,
    readiness: [],
    accounts: { auth, publicOrigin: origin, redis, db: database.db, store, maxUploadBytes: 2 * 1024 * 1024, freeMonthlyCredits: 60 },
    runs,
  });
  // A state-changing route behind the guard, to exercise its CSRF origin check before real ones exist.
  app.post("/api/v1/__test/mutation", { onRequest: requireUser(auth, [origin]) }, async (req) => ({ userId: req.user?.id }));
  await app.ready();
  return {
    app,
    auth,
    mailer,
    database,
    store,
    runs,
    origin,
    async close() {
      await app.close();
      await Promise.allSettled([database.close(), redis.quit()]);
      store.close();
      await queues.close();
      queueConnection.disconnect();
    },
    async reset() {
      await truncateAll(database);
      await redis.flushdb();
      mailer.sent.length = 0;
    },
  };
}

/** `name=value` pairs from Set-Cookie headers, merged into an existing jar (a cleared cookie is removed). */
export function cookieJar(response: LightMyRequestResponse, jar: Record<string, string> = {}): Record<string, string> {
  const raw = response.headers["set-cookie"];
  for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    const [pair] = line.split(";");
    const eq = pair?.indexOf("=") ?? -1;
    if (!pair || eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === "" || /max-age=0/i.test(line)) delete jar[name];
    else jar[name] = value;
  }
  return jar;
}

export const cookieHeader = (jar: Record<string, string>) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

/** The link of the last email sent to `to`, as a path + query the app can be injected with. */
export function lastLink(mailer: MemoryMailer, to: string): string {
  const mail = [...mailer.sent].reverse().find((m) => m.to === to);
  const url = mail?.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error(`no link mailed to ${to}`);
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export async function signUp(h: Harness, email: string, password = PASSWORD): Promise<LightMyRequestResponse> {
  return h.app.inject({ method: "POST", url: "/api/auth/sign-up/email", headers: { origin: h.origin }, payload: { email, password, name: "Seller" } });
}

export async function signIn(h: Harness, email: string, password = PASSWORD, ip = "203.0.113.10"): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: h.origin, "x-forwarded-for": ip },
    remoteAddress: "10.0.0.2",
    payload: { email, password },
  });
}

/** Signs up, follows the verification link and returns the session cookies. */
export async function verifiedUser(h: Harness, email: string): Promise<Record<string, string>> {
  await signUp(h, email);
  const verified = await h.app.inject({ method: "GET", url: lastLink(h.mailer, email) });
  const jar = cookieJar(verified);
  if (Object.keys(jar).length > 0) return jar;
  return cookieJar(await signIn(h, email));
}
