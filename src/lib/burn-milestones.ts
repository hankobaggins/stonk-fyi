import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BurnEvent } from "./types";
import { postCardToX } from "./burn-alerts";
import { fmtNum, fmtUsd } from "./format";
import { SITE_URL } from "./site";
import { STONK_INITIAL_SUPPLY, STONK_LAUNCHED_AT } from "./stonk";
import { daysBetween, findCrossing, fmtDays, milestoneFloor, newMilestones } from "./milestone-math";

// Burn milestones → X. Every snapshot tick compares the lifetime burned share of the 1B supply with the
// highest whole percent already in `burn_milestones`. Crossing a new whole percent inserts a row (claimed
// before posting, so a concurrent tick can't double-post), renders /milestone-card/{pct} and posts it
// through SocialBu. An empty table is seeded with the current level and nothing is posted, so going
// live never replays old milestones. Without SOCIALBU_TOKEN rows are recorded as dry_run.

export type MilestoneContext = {
  burnedTokens: number;
  burnedValueUsd: number | null;
  burnCount: number | null;
  supplyBurnedPct: number;
  velocityPctDay: number | null;
  velocitySignal: "bull" | "neutral" | "bear" | "info";
  priceUsd: number | null;
  marketCapUsd: number | null;
  burns: BurnEvent[];
};

export type MilestoneRow = {
  pct: number;
  ts: string;
  reached_at: string | null;
  crossing_signature: string | null;
  burned_tokens: number;
  burned_value_usd: number | null;
  burn_count: number | null;
  supply_burned_pct: number;
  velocity_pct_day: number | null;
  velocity_signal: string | null;
  price_usd: number | null;
  market_cap_usd: number | null;
  prev_reached_at: string | null;
  card_url: string | null;
  post_text: string | null;
  socialbu_post_id: string | null;
  status: string;
  error: string | null;
};

// Two plain sentences, no links (same voice as the big-burn alerts).
export function buildMilestoneText(row: Pick<MilestoneRow, "pct" | "burned_tokens" | "burned_value_usd" | "reached_at" | "prev_reached_at" | "velocity_pct_day">, now = new Date().toISOString()): string {
  const at = row.reached_at ?? now;
  const days = Math.floor(daysBetween(STONK_LAUNCHED_AT, at));
  const usd = row.burned_value_usd ? `, about ${fmtUsd(row.burned_value_usd, { compact: true })} at StonkFun pricing` : "";
  const first = `${row.pct}% of $STONK supply is now burned: ${fmtNum(row.burned_tokens)} tokens${usd}, ${days} days after launch.`;
  const parts: string[] = [];
  if (row.prev_reached_at && row.reached_at) parts.push(`The last 1% took ${fmtDays(daysBetween(row.prev_reached_at, row.reached_at))}.`);
  if (row.velocity_pct_day !== null) parts.push(`Burn velocity ${row.velocity_pct_day.toFixed(2)}%/day.`);
  return parts.length ? `${first}\n\n${parts.join(" ")}` : first;
}

export async function getMilestone(db: SupabaseClient, pct: number): Promise<MilestoneRow | null> {
  const { data, error } = await db.from("burn_milestones").select("*").eq("pct", pct).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MilestoneRow | null) ?? null;
}

export async function latestMilestone(db: SupabaseClient): Promise<MilestoneRow | null> {
  const { data, error } = await db.from("burn_milestones").select("*").order("pct", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MilestoneRow | null) ?? null;
}

export async function runBurnMilestone(
  db: SupabaseClient,
  ctx: MilestoneContext,
  opts: { dry?: boolean; now?: string } = {}
): Promise<{ created: number; pct?: number; status?: string; skipped?: number[] }> {
  const now = opts.now ?? new Date().toISOString();
  const last = await latestMilestone(db);
  const floor = milestoneFloor(ctx.supplyBurnedPct);

  if (!last) {
    // First run: record where we are, announce nothing.
    const { error } = await db.from("burn_milestones").insert({
      pct: floor,
      ts: now,
      burned_tokens: ctx.burnedTokens,
      burned_value_usd: ctx.burnedValueUsd,
      burn_count: ctx.burnCount,
      supply_burned_pct: ctx.supplyBurnedPct,
      velocity_pct_day: ctx.velocityPctDay,
      velocity_signal: ctx.velocitySignal,
      price_usd: ctx.priceUsd,
      market_cap_usd: ctx.marketCapUsd,
      status: "seeded",
    });
    if (error) throw new Error(error.message);
    return { created: 0, pct: floor, status: "seeded" };
  }

  const pending = newMilestones(ctx.supplyBurnedPct, last.pct);
  if (!pending.length) return { created: 0 };

  // Only the highest one gets a card; anything below it was missed while the worker was down and is
  // recorded as skipped so the ledger stays contiguous.
  const target = pending[pending.length - 1];
  const skipped = pending.slice(0, -1);
  if (skipped.length) {
    const { error } = await db.from("burn_milestones").insert(
      skipped.map((pct) => ({ pct, ts: now, burned_tokens: ctx.burnedTokens, supply_burned_pct: ctx.supplyBurnedPct, status: "skipped" }))
    );
    if (error) throw new Error(error.message);
  }

  const crossing = findCrossing(ctx.burns, ctx.burnedTokens, STONK_INITIAL_SUPPLY, target);
  const prevReachedAt = skipped.length ? null : last.reached_at;
  const draft = {
    pct: target,
    ts: now,
    reached_at: crossing.reachedAt,
    crossing_signature: crossing.signature,
    burned_tokens: ctx.burnedTokens,
    burned_value_usd: ctx.burnedValueUsd,
    burn_count: ctx.burnCount,
    supply_burned_pct: ctx.supplyBurnedPct,
    velocity_pct_day: ctx.velocityPctDay,
    velocity_signal: ctx.velocitySignal,
    price_usd: ctx.priceUsd,
    market_cap_usd: ctx.marketCapUsd,
    prev_reached_at: prevReachedAt,
  };
  const dry = opts.dry || !process.env.SOCIALBU_TOKEN;
  const postText = buildMilestoneText(draft, now);
  const cardUrl = `${SITE_URL}/milestone-card/${target}`;

  // Claim the milestone before posting; the primary key on pct makes a concurrent tick fail here.
  const { error } = await db.from("burn_milestones").insert({ ...draft, card_url: cardUrl, post_text: postText, status: dry ? "dry_run" : "pending" });
  if (error) throw new Error(error.message);
  if (dry) return { created: 1, pct: target, status: "dry_run", skipped };

  try {
    const postId = await postCardToX(cardUrl, postText, `stonk-milestone-${target}.png`);
    await db.from("burn_milestones").update({ status: "posted", socialbu_post_id: postId }).eq("pct", target);
    return { created: 1, pct: target, status: "posted", skipped };
  } catch (e) {
    await db.from("burn_milestones").update({ status: "failed", error: (e as Error).message }).eq("pct", target);
    throw e;
  }
}
