// Pure burn-velocity trigger math, free of server-only imports so scripts/velocity-alert-check.ts can run it.
// The input is the scorecard's burn-velocity figure: % of supply burned per day over the rolling 4h window
// (BURN_RATE_WINDOW_H in lib/stonk.ts). The scorecard colors it bullish above VELOCITY_ALERT_THRESHOLD_PCT
// (0.3%/day, the same line as the `burnrate` indicator). This rail posts to X once, on the way up.
//
// Two guards keep a figure that hovers around 0.3 from tweeting every tick:
//  - hysteresis: after a "hot" flip the rail is re-armed only once velocity has fallen below
//    VELOCITY_ALERT_REARM_PCT (0.2%/day), not merely below 0.3;
//  - cooldown: at most one post per VELOCITY_ALERT_COOLDOWN_MIN (240 = the window itself). A hot flip inside
//    the cooldown is recorded as `quiet` — it still counts as a flip, so the rail needs a cool-down before
//    the next post, exactly as if it had posted.
// Only transitions are written to the ledger (`hot` / `cool`), never every reading.

import { fmtNum, fmtUsd } from "./format";
import { fmtDays } from "./milestone-math";

export const VELOCITY_ALERT_THRESHOLD_PCT = Number(process.env.VELOCITY_ALERT_THRESHOLD_PCT ?? 0.3);
export const VELOCITY_ALERT_REARM_PCT = Number(process.env.VELOCITY_ALERT_REARM_PCT ?? 0.2);
export const VELOCITY_ALERT_COOLDOWN_MIN = Number(process.env.VELOCITY_ALERT_COOLDOWN_MIN ?? 240);

export type VelocityState = "hot" | "cool";

export type VelocityRules = { thresholdPct: number; rearmPct: number; cooldownMin: number };
export const DEFAULT_RULES: VelocityRules = { thresholdPct: VELOCITY_ALERT_THRESHOLD_PCT, rearmPct: VELOCITY_ALERT_REARM_PCT, cooldownMin: VELOCITY_ALERT_COOLDOWN_MIN };

export type VelocityDecision =
  | { action: "seed"; state: VelocityState }
  | { action: "none" }
  | { action: "cool" }
  | { action: "hot"; announce: boolean };

// `pctDay` null = no burns in the window at all → velocity 0.
export function stateFor(pctDay: number | null, rules: VelocityRules = DEFAULT_RULES): VelocityState {
  return (pctDay ?? 0) > rules.thresholdPct ? "hot" : "cool";
}

export function evaluateVelocity(
  pctDay: number | null,
  lastState: VelocityState | null,
  lastPostedAt: string | null,
  now: string,
  rules: VelocityRules = DEFAULT_RULES
): VelocityDecision {
  const v = Number.isFinite(pctDay) ? (pctDay as number) : 0;
  if (lastState === null) return { action: "seed", state: stateFor(v, rules) };
  if (lastState === "cool") {
    if (v <= rules.thresholdPct) return { action: "none" };
    const cooled = lastPostedAt === null || Date.parse(now) - Date.parse(lastPostedAt) >= rules.cooldownMin * 60_000;
    return { action: "hot", announce: cooled };
  }
  // hot: stays hot until velocity falls below the re-arm level (hysteresis)
  return v < rules.rearmPct ? { action: "cool" } : { action: "none" };
}

// "3h 20m" / "45m" / "2.3 days" for the "up from X%/day N ago" phrasing.
export function fmtSince(fromIso: string, toIso: string): string {
  const min = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 48 * 60) { const h = Math.floor(min / 60); const m = min % 60; return m ? `${h}h ${m}m` : `${h}h`; }
  return `${(min / 1440).toFixed(1)} days`;
}

export type VelocityTextInput = { ts: string; pct_day: number; prev_pct_day: number | null; prev_ts: string | null; window_hours: number | null; window_tokens: number | null; window_usd: number | null; window_burns: number | null; supply_burned_pct: number | null };

// Two plain sentences, no links — the same voice as the burn, milestone and ATH posts.
export function buildVelocityText(r: VelocityTextInput): string {
  const hours = r.window_hours ?? 4;
  const span = Math.abs(hours - Math.round(hours)) < 0.05 ? `${Math.round(hours)} hours` : `${hours.toFixed(1)} hours`;
  const detail: string[] = [];
  if (r.window_tokens !== null) detail.push(`${fmtNum(r.window_tokens)} tokens`);
  if (r.window_usd !== null) detail.push(`about ${fmtUsd(r.window_usd)} at StonkFun pricing`);
  if (r.window_burns !== null) detail.push(r.window_burns === 1 ? "1 burn" : `${r.window_burns} burns`);
  const first = `$STONK burns are heating up: ${r.pct_day.toFixed(2)}% of supply a day over the last ${span}${detail.length ? ` (${detail.join(", ")})` : ""}.`;
  const parts: string[] = [];
  if (r.prev_pct_day !== null && r.prev_ts) parts.push(`Up from ${r.prev_pct_day.toFixed(2)}%/day ${fmtSince(r.prev_ts, r.ts)} ago.`);
  if (r.supply_burned_pct !== null) {
    const next = Math.floor(r.supply_burned_pct) + 1;
    const days = r.pct_day > 0 ? fmtDays((next - r.supply_burned_pct) / r.pct_day) : null;
    parts.push(`${r.supply_burned_pct.toFixed(2)}% of supply is now gone${days ? `; at this pace ${next}% is ~${days} away` : ""}.`);
  }
  return parts.length ? `${first}\n\n${parts.join(" ")}` : first;
}

