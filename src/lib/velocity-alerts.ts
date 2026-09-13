import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { postCardToX } from "./burn-alerts";
import { SITE_URL } from "./site";
import { buildVelocityText, DEFAULT_RULES, evaluateVelocity, VELOCITY_ALERT_COOLDOWN_MIN, VELOCITY_ALERT_REARM_PCT, VELOCITY_ALERT_THRESHOLD_PCT, type VelocityRules, type VelocityState } from "./velocity-math";

// "Burns are heating up" → X. Every snapshot tick reads the scorecard's burn velocity (rolling 4h burn rate,
// % of supply a day) and compares it with the last state in `velocity_alerts`. Crossing above 0.3%/day — the
// line where the `burnrate` cell turns bullish — from a re-armed state posts /velocity-card/{id} through
// SocialBu, at most once per cooldown. Falling below the re-arm level (0.2%/day) writes a `cool` row and
// posts nothing (the ledger keeps both directions so the story is honest; only the way up is announced).
// An empty table is seeded with the current state and posts nothing. Without SOCIALBU_TOKEN rows are dry_run.

export { buildVelocityText, VELOCITY_ALERT_COOLDOWN_MIN, VELOCITY_ALERT_REARM_PCT, VELOCITY_ALERT_THRESHOLD_PCT };

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

export async function getVelocityAlert(db: SupabaseClient, id: number): Promise<VelocityRow | null> {
  const { data, error } = await db.from("velocity_alerts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VelocityRow | null) ?? null;
}

// The newest transition — the state the rail is in.
export async function lastVelocityRow(db: SupabaseClient): Promise<VelocityRow | null> {
  const { data, error } = await db.from("velocity_alerts").select("*").order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VelocityRow | null) ?? null;
}

// Newest row that counts as a post for the cooldown (quiet flips count too: a flip is a flip; failed posts don't).
export async function lastVelocityPost(db: SupabaseClient): Promise<VelocityRow | null> {
  const { data, error } = await db.from("velocity_alerts").select("*").in("status", ["posted", "pending", "dry_run", "quiet"]).order("ts", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VelocityRow | null) ?? null;
}

export async function recentVelocityAlerts(db: SupabaseClient, limit = 20): Promise<VelocityRow[]> {
  const { data, error } = await db.from("velocity_alerts").select("*").order("ts", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as VelocityRow[];
}

export async function runVelocityAlert(
  db: SupabaseClient,
  ctx: VelocityContext,
  opts: { dry?: boolean; now?: string; rules?: VelocityRules } = {}
): Promise<{ created: number; id?: number; pctDay?: number; status?: string }> {
  const now = opts.now ?? new Date().toISOString();
  const rules = opts.rules ?? DEFAULT_RULES;
  if (ctx.estimate) return { created: 0, status: "skipped: rate is an API-tail estimate (no burn ledger)" };

  const [last, lastPost] = await Promise.all([lastVelocityRow(db), lastVelocityPost(db)]);
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
    const { data, error } = await db.from("velocity_alerts").insert(row).select("id").single();
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

  const dry = opts.dry || !process.env.SOCIALBU_TOKEN;
  const postText = buildVelocityText(base);
  const id = await insert({ ...base, state: "hot", post_text: postText, status: dry ? "dry_run" : "pending" });
  const cardUrl = `${SITE_URL}/velocity-card/${id}`;
  await db.from("velocity_alerts").update({ card_url: cardUrl }).eq("id", id);
  if (dry) return { created: 1, id, pctDay: base.pct_day, status: "dry_run" };

  try {
    const postId = await postCardToX(cardUrl, postText, `stonk-velocity-${id}.png`);
    await db.from("velocity_alerts").update({ status: "posted", socialbu_post_id: postId }).eq("id", id);
    return { created: 1, id, pctDay: base.pct_day, status: "posted" };
  } catch (e) {
    await db.from("velocity_alerts").update({ status: "failed", error: (e as Error).message }).eq("id", id);
    throw e;
  }
}
