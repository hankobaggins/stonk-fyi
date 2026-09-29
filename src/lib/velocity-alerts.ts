import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { postCardToX } from "./burn-alerts";
import { SITE_URL } from "./site";
import { buildFireText, buildVelocityText, DEFAULT_RULES, evaluateVelocity, FIRE_ALERT_COOLDOWN_MIN, FIRE_ALERT_REARM_PCT, FIRE_ALERT_THRESHOLD_PCT, FIRE_RULES, supersededByFire, VELOCITY_ALERT_COOLDOWN_MIN, VELOCITY_ALERT_REARM_PCT, VELOCITY_ALERT_THRESHOLD_PCT, type VelocityRules, type VelocityState, type VelocityTextInput } from "./velocity-math";

// "Burns are heating up" → X. Every snapshot tick reads the scorecard's burn velocity (rolling 4h burn rate,
// % of supply a day) and compares it with the last state in `velocity_alerts`. Crossing above 0.3%/day — the
// line where the `burnrate` cell turns bullish — from a re-armed state posts /velocity-card/{id} through
// SocialBu, at most once per cooldown. Falling below the re-arm level (0.2%/day) writes a `cool` row and
// posts nothing (the ledger keeps both directions so the story is honest; only the way up is announced).
// An empty table is seeded with the current state and posts nothing. Without SOCIALBU_TOKEN rows are dry_run.
//
// "Burns are on fire" (§6n) is the same state machine on its own ledger, `fire_alerts`: above 0.5%/day, re-armed
// below 0.4, card /fire-card/{id}. The tick runs it first; a heating-up flip within the heating-up cooldown of an
// on-fire announcement is recorded quiet (the hotter post supersedes — never two tweets for one surge).

export { buildFireText, buildVelocityText, FIRE_ALERT_COOLDOWN_MIN, FIRE_ALERT_REARM_PCT, FIRE_ALERT_THRESHOLD_PCT, VELOCITY_ALERT_COOLDOWN_MIN, VELOCITY_ALERT_REARM_PCT, VELOCITY_ALERT_THRESHOLD_PCT };

export type VelocityTable = "velocity_alerts" | "fire_alerts";
type Rail = { table: VelocityTable; rules: VelocityRules; cardPath: string; fileTag: string; text: (r: VelocityTextInput) => string };
const HEATING_RAIL: Rail = { table: "velocity_alerts", rules: DEFAULT_RULES, cardPath: "velocity-card", fileTag: "velocity", text: buildVelocityText };
const FIRE_RAIL: Rail = { table: "fire_alerts", rules: FIRE_RULES, cardPath: "fire-card", fileTag: "fire", text: buildFireText };

export type VelocityContext = {
  pctDay: number | null;            // burn velocity now; null = no burns in the window
  estimate: boolean;                // true when the rate comes from the API tail only (no ledger) — never post on an estimate
  windowHours: number | null;
  windowTokens: number | null;
  windowUsd: number | null;
  windowBurns: number | null;
  tokensPerHour: number | null;
  supplyBurnedPct: number;
  priceUsd: number | null;
  marketCapUsd: number | null;
};

export type VelocityRow = {
  id: number;
  ts: string;
  state: VelocityState;
  pct_day: number;
  threshold_pct: number;
  rearm_pct: number;
  prev_id: number | null;
  prev_pct_day: number | null;
  prev_ts: string | null;
  window_hours: number | null;
  window_tokens: number | null;
  window_usd: number | null;
  window_burns: number | null;
  tokens_per_hour: number | null;
  supply_burned_pct: number | null;
  price_usd: number | null;
  market_cap_usd: number | null;
  card_url: string | null;
  post_text: string | null;
  socialbu_post_id: string | null;
  status: string;
  error: string | null;
};

export async function getVelocityAlert(db: SupabaseClient, id: number, table: VelocityTable = "velocity_alerts"): Promise<VelocityRow | null> {
  const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VelocityRow | null) ?? null;
}

// The newest transition — the state the rail is in.
export async function lastVelocityRow(db: SupabaseClient, table: VelocityTable = "velocity_alerts"): Promise<VelocityRow | null> {
  const { data, error } = await db.from(table).select("*").order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VelocityRow | null) ?? null;
}

// Newest row that counts as a post for the cooldown (quiet flips count too: a flip is a flip; failed posts don't).
export async function lastVelocityPost(db: SupabaseClient, table: VelocityTable = "velocity_alerts"): Promise<VelocityRow | null> {
  const { data, error } = await db.from(table).select("*").in("status", ["posted", "pending", "dry_run", "quiet"]).order("ts", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VelocityRow | null) ?? null;
}

export async function recentVelocityAlerts(db: SupabaseClient, limit = 20, table: VelocityTable = "velocity_alerts"): Promise<VelocityRow[]> {
  const { data, error } = await db.from(table).select("*").order("ts", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as VelocityRow[];
}

// Newest row that was (or would have been) announced — not quiet, not failed. Used for the supersede rule.
export async function lastAnnounced(db: SupabaseClient, table: VelocityTable): Promise<VelocityRow | null> {
  const { data, error } = await db.from(table).select("*").in("status", ["posted", "pending", "dry_run"]).order("ts", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VelocityRow | null) ?? null;
}

type RunOpts = { dry?: boolean; now?: string; rules?: VelocityRules };
type RunResult = { created: number; id?: number; pctDay?: number; status?: string };

// "Burns are heating up" (0.3%/day). `supersededAt` = the on-fire rail's last announcement (see supersededByFire).
export function runVelocityAlert(db: SupabaseClient, ctx: VelocityContext, opts: RunOpts & { supersededAt?: string | null } = {}): Promise<RunResult> {
  return runRail(db, ctx, HEATING_RAIL, opts);
}

// "Burns are on fire" (0.5%/day).
export function runFireAlert(db: SupabaseClient, ctx: VelocityContext, opts: RunOpts = {}): Promise<RunResult> {
  return runRail(db, ctx, FIRE_RAIL, opts);
}

async function runRail(db: SupabaseClient, ctx: VelocityContext, rail: Rail, opts: RunOpts & { supersededAt?: string | null }): Promise<RunResult> {
  const now = opts.now ?? new Date().toISOString();
  const rules = opts.rules ?? rail.rules;
  if (ctx.estimate) return { created: 0, status: "skipped: rate is an API-tail estimate (no burn ledger)" };

  const [last, lastPost] = await Promise.all([lastVelocityRow(db, rail.table), lastVelocityPost(db, rail.table)]);
  const d = evaluateVelocity(ctx.pctDay, last?.state ?? null, lastPost?.ts ?? null, now, rules);
  if (d.action === "none") return { created: 0 };

  const base = {
    ts: now,
    pct_day: ctx.pctDay ?? 0,
    threshold_pct: rules.thresholdPct,
    rearm_pct: rules.rearmPct,
    prev_id: last?.id ?? null,
    prev_pct_day: last?.pct_day ?? null,
    prev_ts: last?.ts ?? null,
    window_hours: ctx.windowHours,
    window_tokens: ctx.windowTokens,
    window_usd: ctx.windowUsd,
    window_burns: ctx.windowBurns,
    tokens_per_hour: ctx.tokensPerHour,
    supply_burned_pct: ctx.supplyBurnedPct,
    price_usd: ctx.priceUsd,
    market_cap_usd: ctx.marketCapUsd,
  };

  // Every insert claims prev_id; the unique index makes a concurrent tick's insert fail instead of double-posting.
  const insert = async (row: Record<string, unknown>): Promise<number> => {
    const { data, error } = await db.from(rail.table).insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return data.id as number;
  };

  if (d.action === "seed") {
    const id = await insert({ ...base, state: d.state, status: "seeded" });
    return { created: 0, id, pctDay: base.pct_day, status: `seeded ${d.state}` };
  }
  if (d.action === "cool") {
    const id = await insert({ ...base, state: "cool", status: "cooled" });
    return { created: 0, id, pctDay: base.pct_day, status: "cooled" };
  }
  if (!d.announce) {
    const id = await insert({ ...base, state: "hot", status: "quiet" });
    return { created: 0, id, pctDay: base.pct_day, status: "quiet" };
  }
  if (supersededByFire(opts.supersededAt ?? null, now, rules)) {
    const id = await insert({ ...base, state: "hot", status: "quiet", error: `superseded by the on-fire post at ${opts.supersededAt}` });
    return { created: 0, id, pctDay: base.pct_day, status: "quiet (superseded by on fire)" };
  }

  const dry = opts.dry || !process.env.SOCIALBU_TOKEN;
  const postText = rail.text(base);
  const id = await insert({ ...base, state: "hot", post_text: postText, status: dry ? "dry_run" : "pending" });
  const cardUrl = `${SITE_URL}/${rail.cardPath}/${id}`;
  await db.from(rail.table).update({ card_url: cardUrl }).eq("id", id);
  if (dry) return { created: 1, id, pctDay: base.pct_day, status: "dry_run" };

  try {
    const postId = await postCardToX(cardUrl, postText, `stonk-${rail.fileTag}-${id}.png`);
    await db.from(rail.table).update({ status: "posted", socialbu_post_id: postId }).eq("id", id);
    return { created: 1, id, pctDay: base.pct_day, status: "posted" };
  } catch (e) {
    await db.from(rail.table).update({ status: "failed", error: (e as Error).message }).eq("id", id);
    throw e;
  }
}
