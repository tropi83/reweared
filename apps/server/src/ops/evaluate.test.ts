import { describe, expect, it } from "vitest";
import { evaluate, selectToSend, type WatchFacts } from "./evaluate";

const healthy: WatchFacts = {
  diskPercent: 40,
  restartingContainers: [],
  readyStatus: 200,
  creditDriftLogged: false,
  failedLastHour: 0,
  workersAlive: 1,
  queued: 3,
};

describe("watch thresholds", () => {
  it("is quiet when everything is fine", () => {
    expect(evaluate(healthy)).toEqual([]);
  });

  it("raises one alert per problem, with stable ids", () => {
    const ids = evaluate({
      diskPercent: 91,
      restartingContainers: ["worker-1"],
      readyStatus: 503,
      creditDriftLogged: true,
      failedLastHour: 11,
      workersAlive: 0,
      queued: 500,
    }).map((a) => a.id);
    expect(ids).toEqual(["disk", "restart:worker-1", "ready", "worker", "credit-drift", "failed-jobs", "queue"]);
  });

  it("only crosses a threshold when it is exceeded", () => {
    expect(evaluate({ ...healthy, diskPercent: 80, failedLastHour: 10, queued: 200 })).toEqual([]);
    expect(evaluate({ ...healthy, diskPercent: 81 }).map((a) => a.id)).toEqual(["disk"]);
  });

  it("never puts personal data in a message", () => {
    for (const a of evaluate({ ...healthy, readyStatus: 500, restartingContainers: ["api-1"] })) expect(a.message).not.toMatch(/@|token|secret/i);
  });

  it("sends each alert key once per window", async () => {
    const seen = new Set<string>();
    const claim = async (id: string) => (seen.has(id) ? false : (seen.add(id), true));
    const alerts = [{ id: "disk", message: "x" }];
    expect(await selectToSend(alerts, claim)).toHaveLength(1);
    expect(await selectToSend(alerts, claim)).toHaveLength(0);
  });
});
