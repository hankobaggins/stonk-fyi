import type { BurnEvent } from "./types";

// Pure window detection, kept free of server-only imports so it can be unit-checked (scripts/burn-alert-check.ts).
// Threshold is in USD (StonkFun's value-at-burn), not tokens: $50K burned inside one 10-minute window.
export const BURN_ALERT_THRESHOLD_USD = Number(process.env.BURN_ALERT_THRESHOLD_USD ?? 50_000);
export const BURN_ALERT_WINDOW_MIN = Number(process.env.BURN_ALERT_WINDOW_MIN ?? 10);

export type BurnWindow = {
  burns: BurnEvent[];        // newest first
  windowStart: string;
  windowEnd: string;
  amountTokens: number;
  valueUsd: number;
  sources: Record<string, number>;
  largest: BurnEvent;
};

// Pure: burns inside [now − windowMin, now] minus already-announced signatures, or null if their USD value is under threshold.
export function findBigBurnWindow(
  burns: BurnEvent[],
  opts: { now?: number; windowMin?: number; thresholdUsd?: number; exclude?: Set<string> } = {}
): BurnWindow | null {
  const now = opts.now ?? Date.now();
  const windowMin = opts.windowMin ?? BURN_ALERT_WINDOW_MIN;
  const thresholdUsd = opts.thresholdUsd ?? BURN_ALERT_THRESHOLD_USD;
  const exclude = opts.exclude ?? new Set<string>();
  const since = now - windowMin * 60_000;
  const inWindow = burns
    .filter((b) => {
      const t = Date.parse(b.burnedAt);
      return t >= since && t <= now + 60_000 && !exclude.has(b.signature);
    })
    .sort((a, b) => Date.parse(b.burnedAt) - Date.parse(a.burnedAt));
  if (!inWindow.length) return null;
  const amountTokens = inWindow.reduce((a, b) => a + b.amountTokens, 0);
  const valueUsd = inWindow.reduce((a, b) => a + (b.valueUsdAtBurn ?? 0), 0);
  if (valueUsd < thresholdUsd) return null;
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
