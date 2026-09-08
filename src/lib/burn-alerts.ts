import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BurnEvent } from "./types";
import { BURN_ALERT_THRESHOLD_USD, BURN_ALERT_WINDOW_MIN, findBigBurnWindow, type BurnWindow } from "./burn-window";

export { findBigBurnWindow, type BurnWindow };
import { fmtNum, fmtUsd } from "./format";
import { SITE_URL } from "./site";

// Big-burn announcements. Every snapshot tick (5 min) looks at STONK burns inside the last
// BURN_ALERT_WINDOW_MIN minutes (10, so consecutive ticks overlap and nothing is missed). Burns
// already covered by an earlier alert are excluded; if what remains is worth ≥ BURN_ALERT_THRESHOLD_USD
// ($10K at StonkFun's value-at-burn), a card is rendered by /burn-card/{id} and posted to X through SocialBu's REST API.
// Without SOCIALBU_TOKEN the alert is recorded as a dry run (row + card URL, no post).

export { BURN_ALERT_THRESHOLD_USD, BURN_ALERT_WINDOW_MIN };
const SOCIALBU_API = process.env.SOCIALBU_API_BASE ?? "https://socialbu.com/api/v1";

export type BurnAlertContext = {
  supplyBurnedPct: number;          // total % of 1B burned, after this window
  velocityPctDay: number | null;    // burn-velocity indicator value
  velocitySignal: "bull" | "neutral" | "bear" | "info";
  priceUsd: number | null;
};

export type BurnAlertRow = {
  id: number;
  ts: string;
  window_start: string;
  window_end: string;
  amount_tokens: number;
  value_usd: number | null;
  burn_count: number;
  sources: Record<string, number> | null;
  supply_burned_pct: number | null;
  velocity_pct_day: number | null;
  velocity_signal: string | null;
  price_usd: number | null;
  largest_signature: string | null;
  card_url: string | null;
  post_text: string | null;
  socialbu_post_id: string | null;
  status: string;
  error: string | null;
};

// Plain-language tweet, two paragraphs, no links (the card carries provenance; /burn-card/{id} keeps it).
export function buildPostText(w: BurnWindow, ctx: BurnAlertContext): string {
  const n = w.burns.length;
  const txs = n === 1 ? "1 tx" : `${n} txs`;
  const velocity = ctx.velocityPctDay !== null ? ` Burn velocity ${ctx.velocityPctDay.toFixed(2)}%/day.` : "";
  return [
    `${fmtNum(w.amountTokens)} $STONK burned in the last ${BURN_ALERT_WINDOW_MIN} minutes (${txs}), about ${fmtUsd(w.valueUsd)} at StonkFun pricing.`,
    `${ctx.supplyBurnedPct.toFixed(2)}% of supply is now gone.${velocity}`,
  ].join("\n\n");
}

export async function alreadyAnnounced(db: SupabaseClient, signatures: string[]): Promise<Set<string>> {
  if (!signatures.length) return new Set();
  const { data, error } = await db.from("burn_alert_signatures").select("signature").in("signature", signatures);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.signature as string));
}

export async function getBurnAlert(db: SupabaseClient, id: number): Promise<BurnAlertRow | null> {
  const { data, error } = await db.from("burn_alerts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BurnAlertRow | null) ?? null;
}

export async function recentBurnAlerts(db: SupabaseClient, limit = 20): Promise<BurnAlertRow[]> {
  const { data, error } = await db.from("burn_alerts").select("*").order("ts", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as BurnAlertRow[];
}

// --- SocialBu REST (https://socialbu.com/api/v1, bearer token from Settings → API for Developers) ---

async function socialbu<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const token = process.env.SOCIALBU_TOKEN;
  if (!token) throw new Error("SOCIALBU_TOKEN not set");
  const res = await fetch(`${SOCIALBU_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SocialBu ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// SocialBu fetches the card from our public URL itself (no bytes pass through Vercel).
async function uploadMediaByUrl(url: string, name: string): Promise<string> {
  const r = await socialbu<{ upload_token?: string | null }>("/upload_media_by_url", { url, name });
  if (!r.upload_token) throw new Error("SocialBu returned no upload_token for the card (still fetching?)");
  return r.upload_token;
}

function utcStamp(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export async function postBurnCard(cardUrl: string, text: string, alertId: number): Promise<string> {
  const accountId = Number(process.env.SOCIALBU_ACCOUNT_ID);
  if (!accountId) throw new Error("SOCIALBU_ACCOUNT_ID not set");
  const token = await uploadMediaByUrl(cardUrl, `stonk-burn-${alertId}.png`);
  const r = await socialbu<{ id?: number | string; post?: { id?: number | string }; posts?: { id?: number | string }[] }>("/posts", {
    content: text,
    accounts: [accountId],
    publish_at: utcStamp(),
    existing_attachments: [{ upload_token: token }],
  });
  return String(r.id ?? r.post?.id ?? r.posts?.[0]?.id ?? "ok");
}

// Runs one alert cycle. Returns the number of alerts created (0 or 1).
export async function runBurnAlert(
  db: SupabaseClient,
  burns: BurnEvent[],
  ctx: BurnAlertContext,
  opts: { dry?: boolean; now?: number } = {}
): Promise<{ created: number; alertId?: number; status?: string }> {
  const candidates = burns.filter((b) => Date.parse(b.burnedAt) >= (opts.now ?? Date.now()) - BURN_ALERT_WINDOW_MIN * 60_000);
  if (!candidates.length) return { created: 0 };
  const exclude = await alreadyAnnounced(db, candidates.map((b) => b.signature));
  const w = findBigBurnWindow(burns, { now: opts.now, exclude });
  if (!w) return { created: 0 };

  const dry = opts.dry || !process.env.SOCIALBU_TOKEN;
  const postText = buildPostText(w, ctx);
  const { data: inserted, error } = await db
    .from("burn_alerts")
    .insert({
      window_start: w.windowStart,
      window_end: w.windowEnd,
      amount_tokens: w.amountTokens,
      value_usd: w.valueUsd,
      burn_count: w.burns.length,
      sources: w.sources,
      supply_burned_pct: ctx.supplyBurnedPct,
      velocity_pct_day: ctx.velocityPctDay,
      velocity_signal: ctx.velocitySignal,
      price_usd: ctx.priceUsd,
      largest_signature: w.largest.signature,
      post_text: postText,
      status: dry ? "dry_run" : "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const alertId = inserted.id as number;
  const cardUrl = `${SITE_URL}/burn-card/${alertId}`;

  // Claim the signatures before posting so a concurrent tick can't announce them too.
  const { error: e2 } = await db.from("burn_alert_signatures").upsert(
    w.burns.map((b) => ({ signature: b.signature, alert_id: alertId })),
    { onConflict: "signature", ignoreDuplicates: true }
  );
  if (e2) throw new Error(e2.message);
  await db.from("burn_alerts").update({ card_url: cardUrl }).eq("id", alertId);

  if (dry) return { created: 1, alertId, status: "dry_run" };
  try {
    const postId = await postBurnCard(cardUrl, postText, alertId);
    await db.from("burn_alerts").update({ status: "posted", socialbu_post_id: postId }).eq("id", alertId);
    return { created: 1, alertId, status: "posted" };
  } catch (e) {
    await db.from("burn_alerts").update({ status: "failed", error: (e as Error).message }).eq("id", alertId);
    throw e;
  }
}
