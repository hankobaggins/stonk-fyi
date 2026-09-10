import type { BurnEvent } from "./types";

// Pure milestone math, free of server-only imports so scripts/burn-milestone-check.ts can run it.
// A milestone is every whole percent of the fixed 1B supply burned (13%, 14%, ...).
export const MILESTONE_STEP_PCT = 1;

export type MilestoneCrossing = {
  pct: number;                 // the whole percent crossed
  reachedAt: string | null;    // burnedAt of the burn that crossed it, when it is inside `burns`
  signature: string | null;
};

// Highest whole-percent milestone at or below `burnedPct`.
export function milestoneFloor(burnedPct: number): number {
  return Math.floor(burnedPct / MILESTONE_STEP_PCT) * MILESTONE_STEP_PCT;
}

// Which milestones lie in (lastRecorded, floor(current)]? Normally none or one; more than one only if
// the worker was down for days. Returned ascending.
export function newMilestones(burnedPct: number, lastRecorded: number | null): number[] {
  const top = milestoneFloor(burnedPct);
  if (lastRecorded === null || !Number.isFinite(lastRecorded)) return [];
  const out: number[] = [];
  for (let p = lastRecorded + MILESTONE_STEP_PCT; p <= top; p += MILESTONE_STEP_PCT) out.push(p);
  return out;
}

// Find the burn that pushed the lifetime total across `pct` of `supply`: walk the recent burns newest
// first, subtracting each from the current total, and stop at the first burn whose "before" total is
// under the line. Null when the crossing predates the API's recent window (~25 burns).
export function findCrossing(burns: BurnEvent[], burnedTotal: number, supply: number, pct: number): MilestoneCrossing {
  const line = (pct / 100) * supply;
  if (burnedTotal < line) return { pct, reachedAt: null, signature: null };
  const sorted = [...burns].filter((b) => Number.isFinite(Date.parse(b.burnedAt))).sort((a, b) => Date.parse(b.burnedAt) - Date.parse(a.burnedAt));
  let after = burnedTotal;
  for (const b of sorted) {
    const before = after - b.amountTokens;
    if (before < line && after >= line) return { pct, reachedAt: b.burnedAt, signature: b.signature };
    after = before;
  }
  return { pct, reachedAt: null, signature: null };
}

export const daysBetween = (fromIso: string, toIso: string): number => (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;

export function fmtDays(d: number): string {
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`;
  return `${d.toFixed(1)} days`;
}
