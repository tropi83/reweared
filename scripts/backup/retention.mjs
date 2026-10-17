// Which database backups to keep: the newest of each of the last 7 days, 4 weeks and 6 months that have one
// (counted among the backups that exist, so a long outage never empties the history), and always the newest.
// Names look like db-20261017T021500Z.dump.age. Usage (used by backup.sh): node retention.mjs < names → names to delete.
import { pathToFileURL } from "node:url";

export const KEEP = { daily: 7, weekly: 4, monthly: 6 };
const NAME = /^db-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump\.age$/;

export function parseBackupName(name) {
  const m = NAME.exec(name);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

const day = (t) => t.toISOString().slice(0, 10);
const month = (t) => t.toISOString().slice(0, 7);
/** Monday of the week, as a day string. */
const week = (t) => {
  const monday = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - ((t.getUTCDay() + 6) % 7)));
  return day(monday);
};

export function selectToDelete(names) {
  const backups = names
    .map((name) => ({ name, at: parseBackupName(name) }))
    .filter((b) => b.at)
    .sort((a, b) => b.at - a.at);
  const kept = new Set();
  for (const [bucket, count] of [
    [day, KEEP.daily],
    [week, KEEP.weekly],
    [month, KEEP.monthly],
  ]) {
    const seen = new Set();
    for (const b of backups) {
      const key = bucket(b.at);
      if (seen.has(key)) continue;
      if (seen.size >= count) break;
      seen.add(key);
      kept.add(b.name);
    }
  }
  // Files that are not ours (unparsable names) are never deleted.
  return backups.filter((b) => !kept.has(b.name)).map((b) => b.name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const names = input
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const name of selectToDelete(names)) console.log(name);
  });
}
