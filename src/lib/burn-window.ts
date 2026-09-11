import type { BurnEvent } from "./types";

// Pure window detection, kept free of server-only imports so it can be unit-checked (scripts/burn-alert-check.ts).
// Threshold is in USD (StonkFun's value-at-burn), not tokens: $120K burned inside one 60-minute window
// (2026-09-11; was $10K / 10 min from 2026-09-08, $50K / 10 min before that).
export const BURN_ALERT_THRESHOLD_USD = Number(process.env.BURN_ALERT_THRESHOLD_USD ?? 120_000);
export const BURN_ALERT_WINDOW_MIN = Number(process.env.BURN_ALERT_WINDOW_MIN ?? 60);

export type BurnWindow = {
  burns: BurnEvent[];        // newest first
  windowStart: string;
  windowEnd: string;
  amountTokens: number;
  valueUsd: number;
  sources: Record<string, number>;
  largest: BurnEvent;
};

// Pure. Slides a windowMin-wide window over every burn newer than `lookbackMin` (default: no limit —
// the burns endpoint only returns the last ~25 events anyway) and returns the most recent window whose
// un-announced burns are worth ≥ thresholdUsd, or null. Sliding rather than "last hour from now" so a
// late or lagging tick (GitHub's scheduler has run hours apart) still catches a window that already closed.
export function findBigBurnWindow(
  burns: BurnEvent[],
  opts: { now?: number; windowMin?: number; thresholdUsd?: number; exclude?: Set<string>; lookbackMin?: number } = {}
): BurnWindow | null {
  const now = opts.now ?? Date.now();
  const windowMin = opts.windowMin ?? BURN_ALERT_WINDOW_MIN;
  const thresholdUsd = opts.thresholdUsd ?? BURN_ALERT_THRESHOLD_USD;
  const exclude = opts.exclude ?? new Set<string>();
  const since = opts.lookbackMin === undefined ? -Infinity : now - opts.lookbackMin * 60_000;
  const pool = burns
    .filter((b) => {
      const t = Date.parse(b.burnedAt);
      return Number.isFinite(t) && t >= since && t <= now + 60_000 && !exclude.has(b.signature);
    })
    .sort((a, b) => Date.parse(b.burnedAt) - Date.parse(a.burnedAt)); // newest first
  if (!pool.length) return null;
  const span = windowMin * 60_000;
  // Anchor a window at each burn (as its newest event) and take the first (most recent) that qualifies.
  for (let i = 0; i < pool.length; i++) {
    const end = Date.parse(pool[i].burnedAt);
    const inWindow = pool.filter((b) => {
      const t = Date.parse(b.burnedAt);
      return t <= end && t > end - span;
    });
    const valueUsd = inWindow.reduce((a, b) => a + (b.valueUsdAtBurn ?? 0), 0);
    if (valueUsd < thresholdUsd) continue;
    const amountTokens = inWindow.reduce((a, b) => a + b.amountTokens, 0);
    const sources: Record<string, number> = {};
    for (const b of inWindow) sources[b.source ?? "unknown"] = (sources[b.source ?? "unknown"] ?? 0) + 1;
    const largest = inWindow.reduce((m, b) => (b.amountTokens > m.amountTokens ? b : m), inWindow[0]);
    return {
      burns: inWindow,
      windowStart: inWindow[inWindow.length - 1].burnedAt,
      windowEnd: inWindow[0].burnedAt,
      amountTokens,
      valueUsd,
      sources,
      largest,
    };
  }
  return null;
}
