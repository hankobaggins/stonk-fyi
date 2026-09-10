import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { postCardToX } from "./burn-alerts";
import { ATH_ALERT_COOLDOWN_MIN, athCandidate, evaluateAth } from "./ath-math";
import { fmtUsd } from "./format";
import { SITE_URL } from "./site";

// All-time-high alerts → X. Every snapshot tick takes the higher of STONK's live market cap and StonkFun's
// peakMarketCapUsd and compares it with the highest figure in `ath_alerts`. A new high is always recorded;
// it is posted (/ath-card/{id} through SocialBu) only when ATH_ALERT_COOLDOWN_MIN minutes have passed since
// the last post, otherwise the row is `quiet`. An empty table is seeded from StonkFun's peak and nothing is
// posted, so going live never announces a high that was already set. Without SOCIALBU_TOKEN rows are dry_run.

export { ATH_ALERT_COOLDOWN_MIN };

export type AthContext = {
  marketCapUsd: number | null;
  peakMarketCapUsd: number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  launchMarketCapUsd: number;
  supplyBurnedPct: number;
};

export type AthRow = {
  id: number;
  ts: string;
  market_cap_usd: number;
  source: string;
  prev_high_usd: number | null;
  prev_high_at: string | null;
  gain_pct: number | null;
  price_usd: number | null;
  price_change_24h: number | null;
  launch_mcap_usd: number | null;
  supply_burned_pct: number | null;
  card_url: string | null;
  post_text: string | null;
  socialbu_post_id: string | null;
  status: string;
  error: string | null;
};

const price = (n: number | null): string => (n === null ? "—" : n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}` : `$${n.toFixed(4)}`);

// Two plain sentences, no links (same voice as the burn alerts and milestones).
export function buildAthText(r: Pick<AthRow, "market_cap_usd" | "prev_high_usd" | "prev_high_at" | "gain_pct" | "price_usd" | "price_change_24h" | "supply_burned_pct">): string {
  const prev = r.prev_high_usd
    ? `, ${r.gain_pct !== null && r.gain_pct >= 0.05 ? `+${r.gain_pct.toFixed(1)}% over` : "just above"} the previous high of ${fmtUsd(r.prev_high_usd)}${r.prev_high_at ? ` set ${r.prev_high_at.slice(0, 10)}` : ""}`
    : "";
  const first = `New $STONK all-time high: ${fmtUsd(r.market_cap_usd)} market cap at StonkFun pricing${prev}.`;
  const parts: string[] = [];
  if (r.price_usd !== null) parts.push(`Price ${price(r.price_usd)}${r.price_change_24h !== null ? ` (${r.price_change_24h >= 0 ? "+" : ""}${r.price_change_24h.toFixed(1)}% 24h)` : ""}.`);
  if (r.supply_burned_pct !== null) parts.push(`${r.supply_burned_pct.toFixed(2)}% of supply burned.`);
  return parts.length ? `${first}\n\n${parts.join(" ")}` : first;
}

export async function getAthAlert(db: SupabaseClient, id: number): Promise<AthRow | null> {
  const { data, error } = await db.from("ath_alerts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AthRow | null) ?? null;
}

// Highest figure ever recorded (any status) — the line to beat.
export async function highestAth(db: SupabaseClient): Promise<AthRow | null> {
  const { data, error } = await db.from("ath_alerts").select("*").order("market_cap_usd", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AthRow | null) ?? null;
}

// Newest row that counts as a post for the cooldown (failed posts don't: the next high retries).
export async function lastAthPost(db: SupabaseClient): Promise<AthRow | null> {
  const { data, error } = await db.from("ath_alerts").select("*").in("status", ["posted", "pending", "dry_run"]).order("ts", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AthRow | null) ?? null;
}

export async function recentAthAlerts(db: SupabaseClient, limit = 20): Promise<AthRow[]> {
  const { data, error } = await db.from("ath_alerts").select("*").order("ts", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AthRow[];
}

export async function runAthAlert(
  db: SupabaseClient,
  ctx: AthContext,
  opts: { dry?: boolean; now?: string } = {}
): Promise<{ created: number; id?: number; marketCapUsd?: number; status?: string }> {
  const now = opts.now ?? new Date().toISOString();
  const cand = athCandidate(ctx.marketCapUsd, ctx.peakMarketCapUsd);
  if (!cand) return { created: 0 };

  const base = {
    ts: now,
    market_cap_usd: cand.value,
    source: cand.source,
    price_usd: ctx.priceUsd,
    price_change_24h: ctx.priceChange24h,
    launch_mcap_usd: ctx.launchMarketCapUsd,
    supply_burned_pct: ctx.supplyBurnedPct,
  };

  const [prev, lastPost] = await Promise.all([highestAth(db), lastAthPost(db)]);
  if (!prev) {
    // First run: record where the bar is, announce nothing.
    const { data, error } = await db.from("ath_alerts").insert({ ...base, status: "seeded" }).select("id").single();
    if (error) throw new Error(error.message);
    return { created: 0, id: data.id as number, marketCapUsd: cand.value, status: "seeded" };
  }

  const d = evaluateAth(cand.value, prev.market_cap_usd, lastPost?.ts ?? null, now);
  if (!d.newHigh) return { created: 0 };

  const draft = { ...base, prev_high_usd: prev.market_cap_usd, prev_high_at: prev.ts, gain_pct: d.gainPct };
  if (!d.announce) {
    // Inside the cooldown: raise the bar, say nothing.
    const { data, error } = await db.from("ath_alerts").insert({ ...draft, status: "quiet" }).select("id").single();
    if (error) throw new Error(error.message);
    return { created: 0, id: data.id as number, marketCapUsd: cand.value, status: "quiet" };
  }

  const dry = opts.dry || !process.env.SOCIALBU_TOKEN;
  const postText = buildAthText(draft);
  // Claim the figure before posting; the unique index on market_cap_usd makes a concurrent tick fail here.
  const { data: inserted, error } = await db
    .from("ath_alerts")
    .insert({ ...draft, post_text: postText, status: dry ? "dry_run" : "pending" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = inserted.id as number;
  const cardUrl = `${SITE_URL}/ath-card/${id}`;
  await db.from("ath_alerts").update({ card_url: cardUrl }).eq("id", id);
  if (dry) return { created: 1, id, marketCapUsd: cand.value, status: "dry_run" };

  try {
    const postId = await postCardToX(cardUrl, postText, `stonk-ath-${id}.png`);
    await db.from("ath_alerts").update({ status: "posted", socialbu_post_id: postId }).eq("id", id);
    return { created: 1, id, marketCapUsd: cand.value, status: "posted" };
  } catch (e) {
    await db.from("ath_alerts").update({ status: "failed", error: (e as Error).message }).eq("id", id);
    throw e;
  }
}
