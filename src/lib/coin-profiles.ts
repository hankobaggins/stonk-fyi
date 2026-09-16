import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRewards, getTokens, STONK_MINT } from "./api";
import { getDb, memoDb } from "./db";
import { getHolderscanDeltas, getHolderscanHolderCount, getHolderscanStats, HOLDERSCAN_ADVANCED, holderscanEnabled } from "./holderscan";
import type { Token } from "./types";

// HolderScan holder profiles of the largest launched coins (CLAUDE.md §6j): the current top coins by market cap
// (STONK excluded — it has its own holder base on the home page), read by the worker step `coin_profiles` and
// stored in holderscan_snapshots (migration 0014, keyed by mint — the same table as STONK's profile, three routes
// instead of seven). One read per coin = holder count (10 units) + HolderScan's own 1h…30d deltas (20) + stats
// (20: average hold time, retention, HHI / Gini / median position) = 50 units.
//
// Budget: Advanced plan — top 20 every hour on the :25 tick (20 × 50 × 24 × 30 ≈ 720K of 15M units a month); the
// page shows the top 10, so a coin climbing into it usually has readings already. Standard — top 10 every 12 h
// (≈ 30K a month). The page never calls HolderScan: it reads the newest stored row per mint and the site's own
// hourly series for the sparkline. HolderScan's deltas give the 24h / 7d / 30d change from the first read; the
// sparkline grows with the site's own history.

export const COIN_PROFILES_TOP = Math.max(10, Number(process.env.COIN_PROFILES_TOP ?? (HOLDERSCAN_ADVANCED ? 20 : 10)));
export const COIN_PROFILES_EVERY_H = Math.max(1, Number(process.env.COIN_PROFILES_EVERY_H ?? (HOLDERSCAN_ADVANCED ? 1 : 12)));
export const TOP_COINS_SHOWN = 10;

// Its own slot (minute 25–29) so it never shares a run with the universe (:15), the profile (:20 on Standard) or the
// census kicks (:45). Every COIN_PROFILES_EVERY_H hours from 00:25 UTC.
export function coinProfilesDue(ts: string): boolean {
  const d = new Date(ts);
  const m = d.getUTCMinutes();
  return m >= 25 && m < 30 && d.getUTCHours() % COIN_PROFILES_EVERY_H === 0;
}

export type TopCoin = { token: Token; rank: number };

// The largest launched coins by StonkFun market cap, live (one /tokens page, 30 s cache), STONK excluded.
export async function getTopCoinsByMcap(n: number): Promise<TopCoin[]> {
  const page = await getTokens({ sort: "marketCap", page: 1, pageSize: Math.min(100, Math.max(n + 5, 20)) });
  const seen = new Set<string>();
  const out: TopCoin[] = [];
  for (const t of page.data.tokens) {
    if (t.mint === STONK_MINT || seen.has(t.mint) || !((t.market?.marketCapUsd ?? 0) > 0)) continue;
    seen.add(t.mint);
    out.push({ token: t, rank: out.length + 1 });
    if (out.length >= n) break;
  }
  return out;
}

export type CoinProfilesStepResult = { rows: number; read: number; failed: number; skipped: boolean; firstError: string | null; missingStats: number };

// Worker step: profile the top COIN_PROFILES_TOP coins by market cap. Coins HolderScan does not track are counted as
// failed (no row); a coin with a holder count but no deltas / stats is stored with what it answered and the misses
// named in `errors`.
export async function runCoinProfiles(db: SupabaseClient, ts: string, top = COIN_PROFILES_TOP): Promise<CoinProfilesStepResult> {
  if (!holderscanEnabled()) return { rows: 0, read: 0, failed: 0, skipped: true, firstError: "HOLDERSCAN_API_KEY not set", missingStats: 0 };
  const coins = await getTopCoinsByMcap(top);
  let firstError: string | null = null;
  let failed = 0;
  let missingStats = 0;
  const rows: Record<string, unknown>[] = [];
  for (const { token: t } of coins) {
    const count = await getHolderscanHolderCount(t.mint); // paced inside the client
    if (count.holders === null) {
      failed++;
      if (!firstError) firstError = `${t.symbol}: ${count.error}`;
      continue;
    }
    const [deltas, stats] = [await getHolderscanDeltas(t.mint), await getHolderscanStats(t.mint)];
    const errors: string[] = [];
    if (!deltas.deltas) errors.push(`deltas: ${deltas.error}`);
    if (!stats.data) errors.push(`stats: ${stats.error}`);
    if (!stats.data || stats.data.avgTimeHeldSec === null) missingStats++;
    const d = deltas.deltas;
    const s = stats.data;
    rows.push({
      mint: t.mint,
      ts,
      holders: count.holders,
      price_usd: t.market?.priceUsd ?? null,
      market_cap_usd: t.market?.marketCapUsd ?? null,
      d1h: d?.h1 ?? null, d4h: d?.h4 ?? null, d12h: d?.h12 ?? null, d1: d?.d1 ?? null, d3: d?.d3 ?? null, d7: d?.d7 ?? null, d14: d?.d14 ?? null, d30: d?.d30 ?? null,
      hhi: s?.hhi ?? null, gini: s?.gini ?? null, median_position: s?.medianPosition ?? null, avg_time_held_sec: s?.avgTimeHeldSec ?? null, retention_rate: s?.retentionRate ?? null,
      errors: errors.length ? errors.join(" · ") : null,
    });
  }
  if (rows.length) {
    const { error } = await db.from("holderscan_snapshots").upsert(rows, { onConflict: "mint,ts" });
    if (error) throw new Error(`${error.message} (migration 0014 applied?)`);
  } else if (coins.length) {
    throw new Error(`no top coin could be profiled (${firstError})`);
  }
  return { rows: rows.length, read: rows.length, failed, skipped: false, firstError, missingStats };
}

// ---------- reads ----------

export type CoinProfileRow = {
  rank: number;
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  quoteSymbol: string;
  mode: string | null;
  marketCapUsd: number;
  createdAt: string;
  holders: number | null; // HolderScan, newest stored reading
  readAt: string | null;
  d1: number | null; // HolderScan's own deltas from that reading (24h is dropped when the reading is > 36h old)
  d7: number | null;
  d30: number | null;
  avgHoldSec: number | null;
  retention: number | null;
  paid: number | null; // StonkFun's reward-eligible holderCount (reward coins only), live
  series: { ts: number; holders: number }[]; // this site's hourly readings, last 7 days, oldest first
  errors: string[];
};

export type CoinProfiles = {
  status: "ok" | "collecting" | "no-db" | "db-error";
  rows: CoinProfileRow[];
  readCount: number;
  newestAt: string | null;
  generatedAt: string;
};

const SPARK_DAYS = 7;

// The top TOP_COINS_SHOWN coins by market cap right now, each with its newest stored HolderScan profile and its
// 7-day series. A coin that climbed into the top 10 since the last worker read has no row yet ("next read" on the page).
async function getCoinProfilesImpl(n = TOP_COINS_SHOWN): Promise<CoinProfiles> {
  const generatedAt = new Date().toISOString();
  const db = getDb();
  const [coins, rewards] = await Promise.all([getTopCoinsByMcap(n), getRewards().catch(() => null)]);
  const paidBy = new Map((rewards?.data.launches ?? []).map((l) => [l.mint, l.holderCount]));
  const base = (c: TopCoin): CoinProfileRow => ({
    rank: c.rank,
    mint: c.token.mint,
    symbol: c.token.symbol,
    name: c.token.name,
    imageUrl: c.token.imageUrl,
    quoteSymbol: c.token.quote.symbol,
    mode: c.token.mode ?? null,
    marketCapUsd: c.token.market?.marketCapUsd ?? 0,
    createdAt: c.token.createdAt,
    holders: null,
    readAt: null,
    d1: null,
    d7: null,
    d30: null,
    avgHoldSec: null,
    retention: null,
    paid: c.token.mode === "reward" ? (paidBy.get(c.token.mint) ?? null) : null,
    series: [],
    errors: [],
  });
  if (process.env.DATA_SOURCE === "fixture") {
    // Offline dev: a synthetic profile per coin, derived deterministically from the fixture's own figures (no captured
    // HolderScan rows exist — neither the sandbox nor the local VM reaches api.holderscan.com). Not real data.
    const rows = coins.map((c) => {
      const r = base(c);
      const seed = c.token.mint.charCodeAt(0) + c.token.mint.charCodeAt(1) * 3;
      const holders = Math.round((r.paid ?? Math.sqrt(r.marketCapUsd) * 4) * 1.25);
      r.holders = holders;
      r.readAt = new Date(Date.now() - 12 * 60000).toISOString();
      r.d1 = Math.round(holders * (((seed % 7) - 3) / 100));
      r.d7 = Math.round(holders * (((seed % 11) - 4) / 60));
      r.d30 = c.rank % 4 === 0 ? null : Math.round(holders * ((seed % 13) / 30));
      r.avgHoldSec = c.rank % 5 === 0 ? null : 3600 * (6 + (seed % 90) * 2);
      r.retention = c.rank % 5 === 0 ? null : 0.4 + (seed % 50) / 100;
      r.series = Array.from({ length: 24 * 5 }, (_, i) => ({ ts: Date.now() - (24 * 5 - i) * 3.6e6, holders: Math.round(holders - r.d7! * (1 - i / (24 * 5)) + Math.sin(i / 7 + seed) * holders * 0.004) }));
      return r;
    });
    return { status: "ok", rows, readCount: rows.length, newestAt: rows[0]?.readAt ?? null, generatedAt };
  }
  if (!db) return { status: "no-db", rows: coins.map(base), readCount: 0, newestAt: null, generatedAt };
  const mints = coins.map((c) => c.token.mint);
  if (!mints.length) return { status: "collecting", rows: [], readCount: 0, newestAt: null, generatedAt };
  const since = new Date(Date.now() - SPARK_DAYS * 864e5).toISOString();
  // Newest row per mint: the rows of the last 2 cadences, newest first, first hit per mint wins. Then the series.
  const recent = new Date(Date.now() - Math.max(3, COIN_PROFILES_EVERY_H * 2) * 3.6e6).toISOString();
  const [latest, ...series] = await Promise.all([
    db.from("holderscan_snapshots").select("mint, ts, holders, d1, d7, d30, avg_time_held_sec, retention_rate, errors").in("mint", mints).gte("ts", recent).order("ts", { ascending: false }).limit(mints.length * 4),
    ...mints.map((m) => db.rpc("holderscan_series", { p_mint: m, since })),
  ]);
  if (latest.error) {
    console.error(`holderscan_snapshots read failed: ${latest.error.message} (migration 0014 applied?)`);
    return { status: "db-error", rows: coins.map(base), readCount: 0, newestAt: null, generatedAt };
  }
  // A mint outside the recent window (it fell out of the profiled set and came back) still gets its newest row, however old.
  const newest = new Map<string, { ts: string; holders: number; d1: number | null; d7: number | null; d30: number | null; avg_time_held_sec: number | null; retention_rate: number | null; errors: string | null }>();
  for (const r of latest.data ?? []) if (!newest.has(r.mint)) newest.set(r.mint, r);
  const stale = mints.filter((m) => !newest.has(m));
  if (stale.length) {
    const olds = await Promise.all(stale.map((m) => db.from("holderscan_snapshots").select("mint, ts, holders, d1, d7, d30, avg_time_held_sec, retention_rate, errors").eq("mint", m).order("ts", { ascending: false }).limit(1)));
    for (const o of olds) if (o.data?.[0]) newest.set(o.data[0].mint, o.data[0]);
  }
  const rows = coins.map((c, i) => {
    const row = base(c);
    const r = newest.get(c.token.mint);
    if (r) {
      const ageH = (Date.now() - Date.parse(r.ts)) / 3.6e6;
      row.holders = r.holders;
      row.readAt = r.ts;
      row.d1 = ageH < 36 ? r.d1 : null;
      row.d7 = r.d7;
      row.d30 = r.d30;
      row.avgHoldSec = r.avg_time_held_sec;
      row.retention = r.retention_rate;
      row.errors = r.errors ? r.errors.split(" · ") : [];
    }
    const s = series[i];
    row.series = ((s.data ?? []) as { ts: string; holders: number }[]).map((p) => ({ ts: Date.parse(p.ts), holders: p.holders })).sort((a, b) => a.ts - b.ts);
    return row;
  });
  const readCount = rows.filter((r) => r.holders !== null).length;
  const newestAt = rows.map((r) => r.readAt).filter((t): t is string => !!t).sort().pop() ?? null;
  return { status: readCount ? "ok" : "collecting", rows, readCount, newestAt, generatedAt };
}

export const getCoinProfiles = memoDb("getCoinProfiles", 120, getCoinProfilesImpl);
