import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PoolFlow } from "./types";

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
