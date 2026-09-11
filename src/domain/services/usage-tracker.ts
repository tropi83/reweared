/**
 * Local usage accounting. Google exposes no consumption endpoint for API keys, so the app
 * counts its own requests per model and compares them with limits either learned from 429
 * responses (`quotaValue`) or entered by the user. Only requests made from this device are
 * counted — the UI says so.
 */

export type UsageOutcome = "ok" | "rate_limited" | "quota" | "error";

export interface UsageEvent {
  /** Epoch ms. */
  at: number;
  provider: string;
  model: string;
  outcome: UsageOutcome;
  tokens?: number;
}

export interface QuotaLimit {
  perMinute?: number;
  perDay?: number;
  source: "learned" | "manual";
  updatedAt: number;
}

export interface UsageRecord {
  schemaVersion: 1;
  events: UsageEvent[];
  /** Keyed by `${provider}:${model}`. */
  limits: Record<string, QuotaLimit>;
}

export interface UsageWindow {
  used: number;
  limit?: number;
  /** 0..1 when a limit is known. */
  ratio?: number;
}

export interface UsageSnapshot {
  minute: UsageWindow;
  day: UsageWindow & { resetsAt: number };
  /** Requests that came back 429 today (any kind). */
  throttledToday: number;
  tokensToday: number;
  limitSource?: QuotaLimit["source"];
}

/** Google resets daily quotas at midnight Pacific time. */
export function pacificMidnightBefore(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsedMs = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + (now % 1000);
  return now - elapsedMs;
}

export const EMPTY_USAGE: UsageRecord = { schemaVersion: 1, events: [], limits: {} };

const RETENTION_MS = 48 * 60 * 60 * 1000;
const MAX_EVENTS = 5000;

export class UsageTracker {
  private record: UsageRecord = { ...EMPTY_USAGE, events: [], limits: {} };
  private readonly listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly persist: (record: UsageRecord) => Promise<void>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  load(record: UsageRecord | null | undefined): void {
    if (record && record.schemaVersion === 1 && Array.isArray(record.events)) {
      this.record = { schemaVersion: 1, events: record.events.filter((e) => typeof e.at === "number"), limits: { ...(record.limits ?? {}) } };
      this.prune();
    }
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  track(event: Omit<UsageEvent, "at">): void {
    this.record.events.push({ ...event, at: this.now() });
    this.prune();
    this.scheduleSave();
    this.notify();
  }

  /** Records a limit reported by Google. Learned limits never overwrite manual ones. */
  learnLimit(provider: string, model: string, window: "minute" | "day", value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    const key = `${provider}:${model}`;
    const current = this.record.limits[key];
    if (current?.source === "manual") return;
    const next: QuotaLimit = { ...(current ?? { source: "learned", updatedAt: 0 }), source: "learned", updatedAt: this.now() };
    if (window === "minute") next.perMinute = value;
    else next.perDay = value;
    this.record.limits[key] = next;
    this.scheduleSave();
    this.notify();
  }

  setManualLimit(provider: string, model: string, limit: { perMinute?: number; perDay?: number } | null): void {
    const key = `${provider}:${model}`;
    if (!limit || (limit.perMinute === undefined && limit.perDay === undefined)) delete this.record.limits[key];
    else this.record.limits[key] = { ...limit, source: "manual", updatedAt: this.now() };
    this.scheduleSave();
    this.notify();
  }

  getLimit(provider: string, model: string): QuotaLimit | undefined {
    return this.record.limits[`${provider}:${model}`];
  }

  /** Models seen in the retained window, for the settings table. */
  knownModels(): Array<{ provider: string; model: string }> {
    const seen = new Map<string, { provider: string; model: string }>();
    for (const e of this.record.events) seen.set(`${e.provider}:${e.model}`, { provider: e.provider, model: e.model });
    for (const key of Object.keys(this.record.limits)) {
      const [provider, model] = key.split(":") as [string, string];
      seen.set(key, { provider, model });
    }
    return [...seen.values()].sort((a, b) => a.model.localeCompare(b.model));
  }

  snapshot(provider: string, model: string): UsageSnapshot {
    const now = this.now();
    const dayStart = pacificMidnightBefore(now);
    const minuteStart = now - 60_000;
    let minute = 0;
    let day = 0;
    let throttled = 0;
    let tokens = 0;
    for (const e of this.record.events) {
      if (e.provider !== provider || e.model !== model) continue;
      if (e.at >= dayStart) {
        day++;
        if (e.outcome === "rate_limited" || e.outcome === "quota") throttled++;
        tokens += e.tokens ?? 0;
      }
      if (e.at >= minuteStart) minute++;
    }
    const limit = this.getLimit(provider, model);
    const window = (used: number, max: number | undefined): UsageWindow => ({
      used,
      ...(max !== undefined ? { limit: max, ratio: max === 0 ? 1 : Math.min(1, used / max) } : {}),
    });
    return {
      minute: window(minute, limit?.perMinute),
      day: { ...window(day, limit?.perDay), resetsAt: dayStart + 24 * 60 * 60 * 1000 },
      throttledToday: throttled,
      tokensToday: tokens,
      ...(limit ? { limitSource: limit.source } : {}),
    };
  }

  reset(): void {
    this.record = { schemaVersion: 1, events: [], limits: {} };
    this.scheduleSave();
    this.notify();
  }

  toJSON(): UsageRecord {
    return { schemaVersion: 1, events: [...this.record.events], limits: { ...this.record.limits } };
  }

  private prune(): void {
    const cutoff = this.now() - RETENTION_MS;
    this.record.events = this.record.events.filter((e) => e.at >= cutoff).slice(-MAX_EVENTS);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist(this.toJSON()).catch(() => undefined);
    }, 300);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}
