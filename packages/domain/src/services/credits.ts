/**
 * What each kind of job costs, in credits. The single source of truth for the server's reservations and, from
 * phase 3, for what the apps show before the user starts a run. The economic model is expected to change: the
 * amounts are kept here and nowhere else.
 */
export const CREDIT_COSTS = { image: 1, copy: 1 } as const;

export type CreditedJobKind = keyof typeof CREDIT_COSTS;

export function jobCost(kind: CreditedJobKind): number {
  return CREDIT_COSTS[kind];
}

/** Cost of a run: one image job per shot, or one copy job. */
export function runCost(kind: CreditedJobKind, jobCount: number): number {
  return jobCost(kind) * jobCount;
}
