import { readFileSync } from "node:fs";
import { createMailer } from "./auth/create-mailer";
import { loadConfig } from "./config";
import { connectDatabase } from "./db/client";
import { DEFAULT_THRESHOLDS, evaluate, selectToSend, type WatchFacts } from "./ops/evaluate";
import { collectStats } from "./ops/stats";
import { connectRedis } from "./redis";

/** Same alert is mailed at most once per window. */
const WINDOW_SECONDS = 6 * 3600;

/**
 * `deploy/watch.sh` pipes the host's facts (disk, restarting containers, local readiness, the credit check's log line)
 * as JSON on stdin; this adds the server's own (jobs, workers), evaluates the thresholds and mails the owner
 * (ALERT_EMAIL, through the same mailer as the accounts), once per alert per window. Prints the alerts as JSON.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env, (path) => readFileSync(path, "utf8"));
  const input = readFileSync(0, "utf8");
  const host = JSON.parse(input || "{}") as Partial<Pick<WatchFacts, "diskPercent" | "restartingContainers" | "readyStatus" | "creditDriftLogged">>;
  const database = connectDatabase(config.DATABASE_URL);
  const redis = connectRedis(config.REDIS_URL);
  try {
    const stats = await collectStats(database.db, redis);
    const facts: WatchFacts = {
      diskPercent: host.diskPercent ?? 0,
      restartingContainers: host.restartingContainers ?? [],
      readyStatus: host.readyStatus ?? 0,
      creditDriftLogged: host.creditDriftLogged ?? false,
      failedLastHour: stats.failedLastHour,
      workersAlive: stats.workersAlive,
      queued: (stats.queue.queued ?? 0) + (stats.queue.dispatched ?? 0),
    };
    const alerts = evaluate(facts, DEFAULT_THRESHOLDS);
    const toSend = await selectToSend(alerts, async (id) => (await redis.set(`watch:alert:${id}`, "1", "EX", WINDOW_SECONDS, "NX")) === "OK");
    if (toSend.length > 0 && config.ALERT_EMAIL) {
      const text = toSend.map((a) => `- ${a.message}`).join("\n");
      await createMailer(config).send({
        to: config.ALERT_EMAIL,
        subject: `[AI Image Variations] ${toSend.length} alert(s)`,
        text: `${text}\n\nSee OPERATIONS.md → Incidents.`,
        html: `<ul>${toSend.map((a) => `<li>${a.message}</li>`).join("")}</ul><p>See OPERATIONS.md → Incidents.</p>`,
      });
    }
    console.log(JSON.stringify({ alerts, mailed: config.ALERT_EMAIL ? toSend.map((a) => a.id) : [] }));
  } finally {
    redis.disconnect();
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "watch failed");
  process.exit(1);
});
