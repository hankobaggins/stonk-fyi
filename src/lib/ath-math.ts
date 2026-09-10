// Pure all-time-high math, free of server-only imports so scripts/ath-alert-check.ts can run it.
// The ATH is STONK's market cap in USD (StonkFun pricing). Every tick the candidate is the higher of the
// live marketCapUsd and StonkFun's own peakMarketCapUsd; it is a new high only if it beats the highest
// figure already in the `ath_alerts` ledger (which is seeded from StonkFun's peak, so nothing replays).
// Posting is throttled by a cooldown only (owner's call 2026-09-10): a new high inside the cooldown is
// recorded as `quiet` and never announced; the next post needs a high above it, after the cooldown.

export const ATH_ALERT_COOLDOWN_MIN = Number(process.env.ATH_ALERT_COOLDOWN_MIN ?? 60);

export type AthCandidate = { value: number; source: "live-mcap" | "stonkfun-peak" };

// The higher of the two readings, tagged with where it came from. Null when neither is usable.
export function athCandidate(marketCapUsd: number | null | undefined, peakMarketCapUsd: number | null | undefined): AthCandidate | null {
  const live = Number.isFinite(marketCapUsd) && (marketCapUsd as number) > 0 ? (marketCapUsd as number) : null;
  const peak = Number.isFinite(peakMarketCapUsd) && (peakMarketCapUsd as number) > 0 ? (peakMarketCapUsd as number) : null;
  if (live === null && peak === null) return null;
  if (peak === null || (live !== null && live >= peak)) return { value: live as number, source: "live-mcap" };
  return { value: peak, source: "stonkfun-peak" };
}

export type AthDecision = {
  newHigh: boolean;   // candidate beats every figure already recorded
  announce: boolean;  // newHigh and the cooldown since the last post has elapsed
  gainPct: number | null; // vs the previous high
};

export function evaluateAth(
  candidate: number,
  previousHigh: number | null,
  lastPostedAt: string | null,
  now: string,
  cooldownMin = ATH_ALERT_COOLDOWN_MIN
): AthDecision {
  const newHigh = previousHigh !== null && Number.isFinite(previousHigh) && candidate > previousHigh;
  const gainPct = previousHigh ? ((candidate - previousHigh) / previousHigh) * 100 : null;
  if (!newHigh) return { newHigh: false, announce: false, gainPct };
  const cooled = lastPostedAt === null || Date.parse(now) - Date.parse(lastPostedAt) >= cooldownMin * 60_000;
  return { newHigh: true, announce: cooled, gainPct };
}
