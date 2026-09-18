import "server-only";
import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BurnEvent, PoolFlow } from "./types";

// Every DB read a page depends on is bounded by this (2026-09-16): a Supabase origin that stops
// answering (Cloudflare 522) held every route for ~20 s before the first byte, because nothing in
// the request path had a deadline. Page reads use supabase-js's own `db.timeout` with its automatic
// retries OFF — postgrest-js retries a failed GET three times with 1s/2s/4s backoff, which turned a
// dead origin into a fixed ~7 s per query even with a per-request abort. Past the deadline the query
// returns an error, the caller returns null and the page renders its "collecting" / fallback states.
// The worker routes ask for a longer budget and keep the retries (a 503 while PostgREST reloads its
// schema cache is exactly what they are for).
export const DB_PAGE_TIMEOUT_MS = Number(process.env.DB_PAGE_TIMEOUT_MS) || 4_000;
export const DB_WORKER_TIMEOUT_MS = Number(process.env.DB_WORKER_TIMEOUT_MS) || 120_000;

// Circuit breaker for page reads (2026-09-16): once a page-side query fails at the transport level (abort,
// network error, or a gateway 5xx such as Cloudflare's 522), every page-side getDb() answers null for
// DB_BREAKER_MS instead of letting each of the ~10-40 reads a render makes wait out its own deadline
// and pile connections onto an instance that is already down. The worker never trips it. A tripped
// breaker is what a Vercel instance saw, not a verdict on the DB: it re-checks after the window.
export const DB_BREAKER_MS = Number(process.env.DB_BREAKER_MS) || 30_000;
// On globalThis: every route is its own bundle with its own module state, and one instance should share the verdict.
const g = globalThis as typeof globalThis & { __dbDownUntil?: number };
const GATEWAY_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524]);
export const dbBreakerOpen = () => Date.now() < (g.__dbDownUntil ?? 0);
function trip(reason: string) {
  if (!dbBreakerOpen()) console.error(`db breaker tripped for ${DB_BREAKER_MS / 1000}s: ${reason}`);
  g.__dbDownUntil = Date.now() + DB_BREAKER_MS;
}
const observedFetch: typeof fetch = async (input, init) => {
  try {
    const res = await fetch(input, init);
    if (GATEWAY_DOWN.has(res.status)) trip(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    trip((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError" ? "timeout" : (e as Error).message);
    throw e;
  }
};

// Returns null when Supabase isn't configured (the app runs fine as a pure API-poller) — and, for page
// reads, while the breaker is open.
export function getDb(opts?: { timeoutMs?: number; retry?: boolean }): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const worker = opts?.timeoutMs !== undefined && opts.timeoutMs > DB_PAGE_TIMEOUT_MS;
  if (!worker && dbBreakerOpen()) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    db: { timeout: opts?.timeoutMs ?? DB_PAGE_TIMEOUT_MS, retry: opts?.retry ?? worker },
    ...(worker ? {} : { global: { fetch: observedFetch } }),
  });
}

// Shared cache for page-side DB reads (2026-09-16). supabase-js queries bypass Next's fetch cache, so
// before this every render of every tab re-ran its reads against Postgres — /holders alone is ~30
// PostgREST requests (three quote_holder_window RPCs over ~320 mints, ten holderscan_series RPCs, the
// census tables) and LiveRefresh re-renders each open tab every 60 s: the dashboard showed 1.19M API
// requests in 24 h on a t3.nano, which is what kept knocking the instance over. The DB only changes
// when the worker writes (every 5 min at fastest), so a read cached for 60-120 s across every Vercel
// instance and viewer loses nothing. Results go through JSON (Maps preserved) because the data cache
// stores serialisable values; a null from a failed read is cached too, which is the right thing during
// an outage (the page says "collecting" and rechecks after the window).
const MAP_TAG = "__map__";
const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Map ? { [MAP_TAG]: [...x] } : x));
const fromJson = (s: string) => JSON.parse(s, (_k, x) => (x && typeof x === "object" && Array.isArray(x[MAP_TAG]) ? new Map(x[MAP_TAG]) : x));
export function memoDb<A extends unknown[], R>(name: string, revalidate: number, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  if (process.env.DATA_SOURCE === "fixture") return fn;
  const cached = unstable_cache(async (...args: A) => toJson(await fn(...args)), ["db-memo", name], { revalidate });
  return async (...args: A) => fromJson(await cached(...args)) as R;
}

// Net STONK flow through the pool over a window, from recorded reserve snapshots.
// Positive netStonkIntoPool = more STONK sold into the pool than bought out (net selling).
async function getPoolFlowImpl(poolId: string, hours = 24): Promise<PoolFlow | null> {
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
    netStonkUsd: 0, // priced by getPoolFlow, outside the cache (the price changes every render; the reserves do not)
    samples: data.length,
  };
}

// Every recorded burn for a mint inside the trailing window (default 4h), oldest first. The worker
// upserts the API's ~25-event window every tick, so this is the full ledger once it has run for a while.
async function getBurnsSinceImpl(mint: string, hours = 4): Promise<BurnEvent[] | null> {
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
async function getGmgnHistoryImpl(hours = 24): Promise<{ first: GmgnHistoryPoint; last: GmgnHistoryPoint; hours: number } | null> {
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
async function getTokenHistoryImpl(mint: string, days = 7, maxPoints = 600): Promise<{ points: TokenHistoryPoint[]; samples: number; from: string; to: string } | null> {
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

// Hourly deltas of a cumulative counter from 5-minute readings, for the bar charts. One bucket per
// UTC hour, valued at the last reading inside it. When the worker missed hours (pg_cron stalls have
// left 2–7 h holes), the delta across the hole is spread evenly over the missing hours instead of
// landing on the first bucket after it — a 7-hour catch-up once drew as a $293K "hour". The current
// hour is dropped while it is still partial (newest reading earlier than :50), the rolling tiles
// carry the live figure. The counter only rises, so negative deltas are clamped to 0.
function hourlyDeltas(rows: { ts: string; v: number }[]): { date: string; value: number }[] {
  const lastInHour = new Map<string, number>();
  for (const r of rows) lastInHour.set(r.ts.slice(0, 13) + ":00:00Z", r.v);
  const keys = [...lastInHour.keys()].sort();
  const out: { date: string; value: number }[] = [];
  for (let i = 1; i < keys.length; i++) {
    const prevT = Date.parse(keys[i - 1]);
    const curT = Date.parse(keys[i]);
    const gapHours = Math.max(1, Math.round((curT - prevT) / 3.6e6));
    const perHour = Math.max(0, lastInHour.get(keys[i])! - lastInHour.get(keys[i - 1])!) / gapHours;
    for (let k = gapHours - 1; k >= 0; k--) out.push({ date: new Date(curT - k * 3.6e6).toISOString().replace(".000Z", "Z"), value: perHour });
  }
  const newest = rows.length ? Date.parse(rows[rows.length - 1].ts) : 0;
  if (out.length && newest - Date.parse(out[out.length - 1].date) < 50 * 60e3) out.pop();
  return out;
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
async function getRevenuePaceImpl(hours = 48): Promise<RevenuePace | null> {
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
  // Requires the window to be at least 80% covered by data, else null. The base reading must sit
  // close to the window start (two missed ticks, or 10% of the window): after a worker stall the
  // newest reading before "an hour ago" can be hours older, and the delta is then the whole stall,
  // not the last hour. Likewise nothing is reported off a stale newest reading.
  const windowDelta = (h: number) => {
    if (Date.now() - lastT > 20 * 60e3) return null;
    const start = lastT - h * 3.6e6;
    const slack = Math.max(15 * 60e3, h * 3.6e6 * 0.1);
    let base: { ts: string; total_revenue_usd: number } | null = null;
    for (const r of rows) {
      if (Date.parse(r.ts) <= start) base = r;
      else break;
    }
    if (!base) {
      const first = rows[0];
      if ((lastT - Date.parse(first.ts)) / (h * 3.6e6) < 0.8) return null;
      base = first;
    } else if (start - Date.parse(base.ts) > slack) return null;
    return Math.max(0, last.total_revenue_usd - base.total_revenue_usd);
  };
  const hourly = hourlyDeltas(rows.map((r) => ({ ts: r.ts, v: r.total_revenue_usd })));
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
  // Which counter the figures come from: the launch ledger's total (launches_total, migration 0020)
  // or, for history written before it existed, the token index's total (tokens_total).
  source: "launches" | "tokens";
  // The newest counter reset inside the requested window, if any: the reading it was seen at and
  // the values either side. The figures above start after it.
  reset: { ts: string; before: number; after: number } | null;
};

// A cumulative counter that jumps by more than this share between two readings has been reset
// upstream (re-indexed, switched backends), not moved by launches: the platform launches a few
// hundred tokens an hour against a 70K+ total, well under 1% even across a 7-hour hole.
export const COUNTER_RESET_SHARE = 0.1;

// Rows from the newest reset onward (the whole series when there is none), plus that reset.
export function trimCounterResets<T extends { ts: string; v: number }>(rows: T[]): { rows: T[]; reset: LaunchVelocity["reset"] } {
  let start = 0;
  let reset: LaunchVelocity["reset"] = null;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].v;
    const b = rows[i].v;
    if (Math.abs(b - a) > Math.max(a, b) * COUNTER_RESET_SHARE) {
      start = i;
      reset = { ts: rows[i].ts, before: a, after: b };
    }
  }
  return { rows: rows.slice(start), reset };
}

// Launch rate from platform_snapshots: the delta over the window and hourly deltas. Reads the
// launch ledger's total (launches_total) when the window has it, else the token index's total
// (tokens_total) — which counts tokens in StonkFun's index and can dip when pools are removed
// (negative hourly deltas are clamped to 0), and on 2026-09-18 17:45 UTC fell from 74.6K to 8.3K
// in one tick. A jump like that is a reset, not launches: the series is restarted after it and
// the result is null ("unavailable") rather than a 0 or a 65K "hour" until half an hour of
// readings exists past it.
async function getLaunchVelocityImpl(hours = 24): Promise<LaunchVelocity | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - hours * 3.6e6).toISOString();
  const { data, error } = await db.from("platform_snapshots").select("ts, tokens_total, launches_total").gte("ts", since).order("ts", { ascending: true });
  if (error || !data || data.length < 2) return null;
  const all = data as { ts: string; tokens_total: number | null; launches_total: number | null }[];
  const fromLedger = all.filter((r) => typeof r.launches_total === "number").map((r) => ({ ts: r.ts, v: r.launches_total as number }));
  const fromIndex = all.filter((r) => typeof r.tokens_total === "number").map((r) => ({ ts: r.ts, v: r.tokens_total as number }));
  // The ledger column only once it covers at least half the window, so the switch-over does not
  // shrink the figure to a few ticks; before that the token index's history, resets trimmed.
  const ledgerHours = fromLedger.length >= 2 ? (Date.parse(fromLedger[fromLedger.length - 1].ts) - Date.parse(fromLedger[0].ts)) / 3.6e6 : 0;
  const source: LaunchVelocity["source"] = ledgerHours >= hours / 2 ? "launches" : "tokens";
  const { rows, reset } = trimCounterResets(source === "launches" ? fromLedger : fromIndex);
  if (rows.length < 2) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const span = (Date.parse(last.ts) - Date.parse(first.ts)) / 3.6e6;
  if (span < 0.5) return null;
  const hourly = hourlyDeltas(rows);
  const launches = Math.max(0, last.v - first.v);
  return { from: first.ts, to: last.ts, hours: span, launches, perHour: launches / span, samples: rows.length, hourly, source, reset };
}

export type RewardWindow = { mint: string; quoteMint: string; from: string; to: string; fromTokens: number; toTokens: number; hours: number };

// Lifetime-payout delta per reward coin over a window, from reward_snapshots via the
// reward_payout_window(win_hours, mints) SQL function (migration 0006). Scoped to `mints` so the
// query is a handful of primary-key probes per coin regardless of table size (the unscoped 0005
// version stopped finishing inside the API's 8 s statement timeout at ~1M rows). `hours` is the
// real span covered, which can be shorter than requested while history is still accumulating;
// callers decide what counts. Returns null on a DB error (logged), never a partial map.
async function getRewardWindowsImpl(winHours: number, mints: string[]): Promise<Map<string, RewardWindow> | null> {
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
async function getBuybackLeaderboardImpl(hours = 1, top = 10): Promise<BuybackLeaderboard | null> {
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

// ---------- holder_snapshots (migration 0009; /holders) ----------

const readPoolFlow = memoDb("getPoolFlow", 60, getPoolFlowImpl);
export async function getPoolFlow(poolId: string, hours = 24, stonkPriceUsd?: number): Promise<PoolFlow | null> {
  const f = await readPoolFlow(poolId, hours);
  return f ? { ...f, netStonkUsd: f.netStonkIntoPool * (stonkPriceUsd ?? 0) } : null;
}

export const getBurnsSince = memoDb("getBurnsSince", 60, getBurnsSinceImpl);

export const getGmgnHistory = memoDb("getGmgnHistory", 60, getGmgnHistoryImpl);

export const getTokenHistory = memoDb("getTokenHistory", 120, getTokenHistoryImpl);

export const getRevenuePace = memoDb("getRevenuePace", 120, getRevenuePaceImpl);

export const getLaunchVelocity = memoDb("getLaunchVelocity", 120, getLaunchVelocityImpl);

export const getRewardWindows = memoDb("getRewardWindows", 120, getRewardWindowsImpl);

export const getBuybackLeaderboard = memoDb("getBuybackLeaderboard", 60, getBuybackLeaderboardImpl);
