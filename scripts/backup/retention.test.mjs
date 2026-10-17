// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseBackupName, selectToDelete } from "./retention.mjs";

const name = (iso) => `db-${iso.replace(/[-:]/g, "").replace(/\.\d+/, "")}.dump.age`;
/** One backup per night at 02:15 UTC, `count` nights ending on `last`. */
const nightly = (last, count) =>
  Array.from({ length: count }, (_, i) => {
    const t = new Date(Date.parse(`${last}T02:15:00Z`) - i * 86_400_000);
    return name(t.toISOString());
  });

describe("backup retention", () => {
  it("parses names and ignores others", () => {
    expect(parseBackupName("db-20261017T021500Z.dump.age")?.toISOString()).toBe("2026-10-17T02:15:00.000Z");
    expect(parseBackupName("notes.txt")).toBeUndefined();
  });

  it("keeps everything while there are at most 7 nights", () => {
    expect(selectToDelete(nightly("2026-10-17", 7))).toEqual([]);
  });

  it("thins out old nights but keeps one per week and per month", () => {
    const names = nightly("2026-10-17", 200);
    const deleted = new Set(selectToDelete(names));
    const kept = names.filter((n) => !deleted.has(n));
    // The newest 7 nights stay.
    for (const n of nightly("2026-10-17", 7)) expect(kept).toContain(n);
    // 7 days + at most 4 weeks + at most 6 months, and far fewer than 200.
    expect(kept.length).toBeLessThanOrEqual(17);
    expect(kept.length).toBeGreaterThan(7);
    // The oldest night of the last 6 months of history is kept as that month's newest only if it is the newest of its month.
    expect(deleted.size).toBe(names.length - kept.length);
  });

  it("keeps the newest backup of a week even when it is old", () => {
    const names = [name("2026-10-17T02:15:00Z"), name("2026-10-16T02:15:00Z"), name("2026-09-02T02:15:00Z"), name("2026-09-01T02:15:00Z")];
    // Both September nights fall in the 7 newest days and 6 months here: nothing is removed.
    expect(selectToDelete(names)).toEqual([]);
  });

  it("never deletes the newest backup or files it does not recognise", () => {
    const names = [...nightly("2026-10-17", 60), "README.txt"];
    const deleted = selectToDelete(names);
    expect(deleted).not.toContain(nightly("2026-10-17", 1)[0]);
    expect(deleted).not.toContain("README.txt");
  });

  it("counts buckets among existing backups, so an outage does not empty the history", () => {
    const old = nightly("2026-01-31", 3);
    expect(selectToDelete(old)).toEqual([]);
  });
});
