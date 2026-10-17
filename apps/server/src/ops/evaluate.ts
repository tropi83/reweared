/** Facts the host gathers (disk, containers, logs) and the server adds (jobs, workers); thresholds turn them into alerts. */
export interface WatchFacts {
  /** Used space of the data disk, percent. */
  diskPercent: number;
  /** Containers restarted more than the host's limit, by name. */
  restartingContainers: string[];
  /** `/api/v1/ready` status as the host sees it locally. */
  readyStatus: number;
  /** The nightly credit consistency check logged a difference in the last 24 h. */
  creditDriftLogged: boolean;
  /** Failed jobs in the last hour. */
  failedLastHour: number;
  /** Workers whose heartbeat is recent. */
  workersAlive: number;
  /** Jobs waiting (queued + dispatched). */
  queued: number;
  /** Set by deploy.sh when a deployment failed (already sanitised by `sanitizeNote`). */
  deployFailed?: string;
}

export interface WatchThresholds {
  diskPercent: number;
  failedLastHour: number;
  queued: number;
}

export const DEFAULT_THRESHOLDS: WatchThresholds = { diskPercent: 80, failedLastHour: 10, queued: 200 };

export interface Alert {
  /** Stable key: the rate limit is per key. */
  id: string;
  message: string;
}

export function evaluate(facts: WatchFacts, thresholds: WatchThresholds = DEFAULT_THRESHOLDS): Alert[] {
  const alerts: Alert[] = [];
  if (facts.diskPercent > thresholds.diskPercent)
    alerts.push({ id: "disk", message: `Disk is ${facts.diskPercent}% full (limit ${thresholds.diskPercent}%).` });
  for (const name of facts.restartingContainers) alerts.push({ id: `restart:${name}`, message: `Container ${name} keeps restarting.` });
  if (facts.readyStatus !== 200) alerts.push({ id: "ready", message: `/api/v1/ready answers ${facts.readyStatus} locally.` });
  if (facts.workersAlive < 1) alerts.push({ id: "worker", message: "No worker heartbeat: generations are not running." });
  if (facts.creditDriftLogged) alerts.push({ id: "credit-drift", message: "The credit consistency check found balances that differ from their ledger." });
  if (facts.failedLastHour > thresholds.failedLastHour) {
    alerts.push({ id: "failed-jobs", message: `${facts.failedLastHour} jobs failed in the last hour (limit ${thresholds.failedLastHour}).` });
  }
  if (facts.deployFailed) alerts.push({ id: `deploy:${facts.deployFailed}`, message: `Deployment: ${facts.deployFailed}.` });
  if (facts.queued > thresholds.queued) alerts.push({ id: "queue", message: `${facts.queued} jobs are waiting (limit ${thresholds.queued}).` });
  return alerts;
}

/** One mail per alert key per window; `claim` returns true when this call may send (Redis `SET NX EX` in production). */
export async function selectToSend(alerts: Alert[], claim: (id: string) => Promise<boolean>): Promise<Alert[]> {
  const send: Alert[] = [];
  for (const alert of alerts) if (await claim(alert.id)) send.push(alert);
  return send;
}

/** The host's free text is only ever shown as plain words, versions and punctuation. */
export function sanitizeNote(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const clean = text
    .replace(/[^A-Za-z0-9 .,:+_-]/g, "")
    .slice(0, 200)
    .trim();
  return clean === "" ? undefined : clean;
}
