import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BurnEvent, PoolFlow } from "./types";

// Returns null when Supabase isn't configured so the app runs fine as a pure API-poller.
export function getDb(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}


// Net STONK flow through the pool over a window, from recorded reserve snapshots.
// Positive netStonkIntoPool = more STONK sold into the pool than bought out (net selling).
export async function getPoolFlow(poolId: string, hours = 24, stonkPriceUsd?: number): Promise<PoolFlow | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - hours * 3.6e6).toISOString();
  const { data, error } = await db
    .from("pool_snapshots")
    .select("ts, stonk_reserve")
    .eq("pool_id", poolId)
    .gte("ts", since)
    .order("ts", { ascending: true });
  if (error || !data || data.length < 2) return null;
  const first = data[0];
  const last = data[data.length - 1];
  const net = (last.stonk_reserve ?? 0) - (first.stonk_reserve ?? 0);
  return {
    from: first.ts,
    to: last.ts,
    stonkReserveStart: first.stonk_reserve,
    stonkReserveEnd: last.stonk_reserve,
    netStonkIntoPool: net,
    netStonkUsd: net * (stonkPriceUsd ?? 0),
    samples: data.length,
  };
}

// Every recorded burn for a mint inside the trailing window (default 4h), oldest first. The worker
// upserts the API's ~25-event window every tick, so this is the full ledger once it has run for a while.
export async function getBurnsSince(mint: string, hours = 4): Promise<BurnEvent[] | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - hours * 3.6e6).toISOString();
  const { data, error } = await db
    .from("token_burns")
    .select("signature, amount_tokens, value_usd_at_burn, source, burned_at")
    .eq("mint", mint)
    .gte("burned_at", since)
    .order("burned_at", { ascending: true })
    .limit(5000);
  if (error || !data) return null;
  return data.map((r) => ({
    signature: r.signature,
    symbol: "STONK",
    amountTokens: r.amount_tokens ?? 0,
    valueUsdAtBurn: r.value_usd_at_burn ?? 0,
    source: r.source ?? "",
    burnedAt: r.burned_at,
  }));
}

export type GmgnHistoryPoint = { ts: string; holderCount: number; priceUsd: number | null };

// Oldest GMGN snapshot inside the window (default 24h) plus the newest, for holder-growth deltas.
export async function getGmgnHistory(hours = 24): Promise<{ first: GmgnHistoryPoint; last: GmgnHistoryPoint; hours: number } | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - hours * 3.6e6).toISOString();
  const { data, error } = await db.from("gmgn_snapshots").select("ts, holder_count, price_usd").gte("ts", since).order("ts", { ascending: true });
  if (error || !data || data.length < 2) return null;
  const f = data[0];
  const l = data[data.length - 1];
  return {
    first: { ts: f.ts, holderCount: f.holder_count, priceUsd: f.price_usd },
    last: { ts: l.ts, holderCount: l.holder_count, priceUsd: l.price_usd },
    hours: (Date.parse(l.ts) - Date.parse(f.ts)) / 3.6e6,
  };
}

export type TokenHistoryPoint = { ts: number; price: number | null; marketCap: number | null; volume24h: number | null };

// Recorded market snapshots for one token (5 min for the top 100 by volume, hourly for the top
// 500, daily for the rest; 30-day retention). Downsampled to at most `maxPoints` for the chart.
export async function getTokenHistory(mint: string, days = 7, maxPoints = 600): Promise<{ points: TokenHistoryPoint[]; samples: number; from: string; to: string } | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db
    .from("token_snapshots")
    .select("ts, price_usd, market_cap_usd, volume_24h_usd")
    .eq("mint", mint)
    .gte("ts", since)
    .order("ts", { ascending: true })
    .limit(10_000);
  if (error || !data || data.length < 2) return null;
  const step = Math.max(1, Math.ceil(data.length / maxPoints));
  const rows = data.filter((_, i) => i % step === 0 || i === data.length - 1);
  return {
    points: rows.map((r) => ({ ts: Date.parse(r.ts), price: r.price_usd, marketCap: r.market_cap_usd, volume24h: r.volume_24h_usd })),
    samples: data.length,
    from: data[0].ts,
    to: data[data.length - 1].ts,
  };
}

export type RevenuePace = {
  from: string;
  to: string;
  hours: number;
  samples: number;
  lastHour: number | null;
  last6h: number | null;
  last24h: number | null;
  hourly: { date: string; value: number }[];
};

// Fee revenue rate from platform_snapshots (total_revenue_usd every 5 min): rolling 1h / 6h / 24h
// deltas plus hourly buckets for a chart. Lifetime revenue only rises, so deltas are clamped at 0.
export async function getRevenuePace(hours = 48): Promise<RevenuePace | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - hours * 3.6e6).toISOString();
  const { data, error } = await db.from("platform_snapshots").select("ts, total_revenue_usd").gte("ts", since).order("ts", { ascending: true });
  if (error || !data) return null;
  const rows = data.filter((r) => typeof r.total_revenue_usd === "number") as { ts: string; total_revenue_usd: number }[];
  if (rows.length < 2) return null;
  const last = rows[rows.length - 1];
  const lastT = Date.parse(last.ts);
  // Delta over a window: newest reading minus the newest reading at or before window start.
  // Requires the window to be at least 80% covered by data, else null.
  const windowDelta = (h: number) => {
    const start = lastT - h * 3.6e6;
    let base: { ts: string; total_revenue_usd: number } | null = null;
    for (const r of rows) {
      if (Date.parse(r.ts) <= start) base = r;
      else break;
    }
    if (!base) {
      const first = rows[0];
      if ((lastT - Date.parse(first.ts)) / (h * 3.6e6) < 0.8) return null;
      base = first;
    }
    return Math.max(0, last.total_revenue_usd - base.total_revenue_usd);
  };
  const lastInHour = new Map<string, number>();
  for (const r of rows) lastInHour.set(r.ts.slice(0, 13) + ":00:00Z", r.total_revenue_usd);
  const keys = [...lastInHour.keys()].sort();
  const hourly: { date: string; value: number }[] = [];
  for (let i = 1; i < keys.length; i++) hourly.push({ date: keys[i], value: Math.max(0, lastInHour.get(keys[i])! - lastInHour.get(keys[i - 1])!) });
  return {
    from: rows[0].ts,
    to: last.ts,
    hours: (lastT - Date.parse(rows[0].ts)) / 3.6e6,
    samples: rows.length,
    lastHour: windowDelta(1),
    last6h: windowDelta(6),
    last24h: windowDelta(24),
    hourly,
  };
}

export type LaunchVelocity = {
  from: string;
  to: string;
  hours: number;
  launches: number;
  perHour: number;
  samples: number;
  hourly: { date: string; value: number }[];
};

// Launch rate from platform_snapshots (tokens_total every 5 min): the 24h delta and hourly deltas.
// tokens_total counts tokens with live pools and can dip when pools are removed, so negative
// hourly deltas are clamped to 0.
export async function getLaunchVelocity(hours = 24): Promise<LaunchVelocity | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - hours * 3.6e6).toISOString();
  const { data, error } = await db.from("platform_snapshots").select("ts, tokens_total").gte("ts", since).order("ts", { ascending: true });
  if (error || !data || data.length < 2) return null;
  const rows = data.filter((r) => typeof r.tokens_total === "number") as { ts: string; tokens_total: number }[];
  if (rows.length < 2) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const span = (Date.parse(last.ts) - Date.parse(first.ts)) / 3.6e6;
  if (span < 0.5) return null;
  const lastInHour = new Map<string, number>();
  for (const r of rows) lastInHour.set(r.ts.slice(0, 13) + ":00:00Z", r.tokens_total);
  const keys = [...lastInHour.keys()].sort();
  const hourly: { date: string; value: number }[] = [];
  for (let i = 1; i < keys.length; i++) hourly.push({ date: keys[i], value: Math.max(0, lastInHour.get(keys[i])! - lastInHour.get(keys[i - 1])!) });
  const launches = Math.max(0, last.tokens_total - first.tokens_total);
  return { from: first.ts, to: last.ts, hours: span, launches, perHour: launches / span, samples: rows.length, hourly };
}

export type RewardWindow = { mint: string; quoteMint: string; from: string; to: string; fromTokens: number; toTokens: number; hours: number };

// Lifetime-payout delta per reward coin over a window, from reward_snapshots via the
// reward_payout_window(win_hours, mints) SQL function (migration 0006). Scoped to `mints` so the
// query is a handful of primary-key probes per coin regardless of table size (the unscoped 0005
// version stopped finishing inside the API's 8 s statement timeout at ~1M rows). `hours` is the
// real span covered, which can be shorter than requested while history is still accumulating;
// callers decide what counts. Returns null on a DB error (logged), never a partial map.
export async function getRewardWindows(winHours: number, mints: string[]): Promise<Map<string, RewardWindow> | null> {
  const db = getDb();
  if (!db) return null;
  const out = new Map<string, RewardWindow>();
  if (!mints.length) return out;
  const { data, error } = await db.rpc("reward_payout_window", { win_hours: winHours, mints });
  if (error || !data) {
    console.error(`reward_payout_window(${winHours}h, ${mints.length} mints) failed: ${error?.message ?? "no data"} (migration 0006 applied?)`);
    return null;
  }
  for (const r of data as { mint: string; quote_mint: string; from_ts: string; to_ts: string; from_tokens: number; to_tokens: number }[]) {
    out.set(r.mint, {
      mint: r.mint,
      quoteMint: r.quote_mint,
      from: r.from_ts,
      to: r.to_ts,
      fromTokens: r.from_tokens,
      toTokens: r.to_tokens,
      hours: (Date.parse(r.to_ts) - Date.parse(r.from_ts)) / 3.6e6,
    });
  }
  return out;
}

// Drops reward_snapshots rows for coins that are no longer tracked and anything older than
// `retentionDays` (reward_snapshots_prune, migration 0006). Returns rows deleted.
export async function pruneRewardSnapshots(keepMints: string[], retentionDays: number): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const keepAfter = new Date(Date.now() - retentionDays * 864e5).toISOString();
  const { data, error } = await db.rpc("reward_snapshots_prune", { keep_mints: keepMints, keep_after: keepAfter });
  if (error) throw new Error(`reward_snapshots_prune: ${error.message} (migration 0006 applied?)`);
  return Number(data ?? 0);
}

export type BuybackLeaderRow = { symbol: string; mint: string; spentUsd: number; stonkBought: number; txs: number; share: number };
export type BuybackLeaderboard = { from: string; to: string; hours: number; rows: BuybackLeaderRow[]; totalUsd: number; totalStonk: number; txs: number; quotes: number };

// Which fee/quote coins funded STONK buybacks over a window, from the buyback ledger the worker
// accumulates (§6). Ranked by USD spent (StonkFun's value at the time of the buy). `to` is the
// newest buy in the window, so a stalled worker shows up as a stale `to`, not as a quiet hour.
export async function getBuybackLeaderboard(hours = 1, top = 10): Promise<BuybackLeaderboard | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - hours * 3.6e6).toISOString();
  const { data, error } = await db
    .from("buybacks")
    .select("quote_mint, quote_symbol, spent_value_usd, bought_tokens, bought_at")
    .gte("bought_at", since)
    .order("bought_at", { ascending: false })
    .limit(5000);
  if (error || !data) return null;
  const by = new Map<string, BuybackLeaderRow>();
  let totalUsd = 0;
  let totalStonk = 0;
  for (const r of data as { quote_mint: string | null; quote_symbol: string | null; spent_value_usd: number | null; bought_tokens: number | null; bought_at: string }[]) {
    const key = r.quote_mint ?? r.quote_symbol ?? "?";
    const row = by.get(key) ?? { symbol: r.quote_symbol ?? "?", mint: r.quote_mint ?? "", spentUsd: 0, stonkBought: 0, txs: 0, share: 0 };
    row.spentUsd += r.spent_value_usd ?? 0;
    row.stonkBought += r.bought_tokens ?? 0;
    row.txs += 1;
    by.set(key, row);
    totalUsd += r.spent_value_usd ?? 0;
    totalStonk += r.bought_tokens ?? 0;
  }
  const rows = [...by.values()].sort((a, b) => b.spentUsd - a.spentUsd);
  for (const r of rows) r.share = totalUsd > 0 ? r.spentUsd / totalUsd : 0;
  return { from: since, to: data[0]?.bought_at ?? since, hours, rows: rows.slice(0, top), totalUsd, totalStonk, txs: data.length, quotes: rows.length };
}
