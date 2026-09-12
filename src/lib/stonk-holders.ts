import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "./db";
import {
  getHolderscanBreakdowns, getHolderscanDeltas, getHolderscanPnl, getHolderscanStats, getHolderscanSupplyBreakdown, getHolderscanTopHolders,
  getHolderscanWalletCategories, HOLDERSCAN_ADVANCED, holderscanEnabled,
  type HolderBreakdowns, type HolderDeltas, type HolderPnl, type HolderStats, type SupplyBreakdown, type WalletCategories,
} from "./holderscan";

// HolderScan holder profile of a token (CLAUDE.md §6h) — STONK today, keyed by mint so more can follow.
// One read = seven routes (150 units): holder count + top-100 list, HolderScan's own deltas, holders by USD
// and size tier, concentration / median / hold time, aggregate PnL, hold-time classes and supply of the top
// 1000. The worker step `holder_profile` stores a row per read in holderscan_snapshots (migration 0014); the
// home page reads the newest row, the rows ~24h and ~7d before it (for the tiers' own changes) and an hourly
// series for the chart. Nothing on the page calls HolderScan live: the budget is the worker's alone.

export const HOLDERSCAN_RETENTION_DAYS = Math.max(7, Number(process.env.HOLDERSCAN_RETENTION_DAYS ?? 90));
// Advanced plan: every 5-min tick (150 × 288 × 30 ≈ 1.3M units a month of 15M). Standard: every 6 h on the :20
// tick (≈ 18K a month, which with the daily universe reads stays under 200K).
export const PROFILE_EVERY_MIN = HOLDERSCAN_ADVANCED ? 5 : 360;

export function profileDue(ts: string): boolean {
  if (HOLDERSCAN_ADVANCED) return true;
  const d = new Date(ts);
  const m = d.getUTCMinutes();
  return m >= 20 && m < 25 && d.getUTCHours() % 6 === 2;
}

export type HolderProfile = {
  mint: string;
  ts: string;
  holders: number;
  priceUsd: number | null;
  marketCapUsd: number | null;
  deltas: HolderDeltas | null;
  breakdowns: HolderBreakdowns | null;
  stats: HolderStats | null;
  pnl: HolderPnl | null;
  wallets: WalletCategories | null;
  supplyBreakdown: SupplyBreakdown | null;
  top10Share: number | null; // 0..1 of circulating supply, pools included
  top100Share: number | null;
  errors: string[];
};

export type ProfileContext = { priceUsd: number | null; marketCapUsd: number | null; circulating: number };

// Live read of every route. null when even the holder count is unavailable (not tracked, key unset, outage);
// otherwise partial — each missing block is named in `errors`.
export async function readHolderProfile(mint: string, ts: string, ctx: ProfileContext): Promise<HolderProfile | null> {
  if (!holderscanEnabled()) return null;
  const errors: string[] = [];
  const top = await getHolderscanTopHolders(mint, 100);
  if (!top.data) {
    errors.push(`holders: ${top.error}`);
    return null;
  }
  // Amounts are documented in whole tokens; a mint answering in raw base units would show a top-10 share > 100%.
  // Then the read is wrong, not the token: report null rather than a nonsense share.
  const share = (n: number) => {
    const sum = top.data!.holders.slice(0, n).reduce((a, h) => a + h.amount, 0);
    const s = ctx.circulating > 0 ? sum / ctx.circulating : null;
    return s !== null && s >= 0 && s <= 1 ? s : null;
  };
  const [deltas, breakdowns, stats, pnl, wallets, supplyBreakdown] = [
    await getHolderscanDeltas(mint),
    await getHolderscanBreakdowns(mint),
    await getHolderscanStats(mint),
    await getHolderscanPnl(mint),
    await getHolderscanWalletCategories(mint),
    await getHolderscanSupplyBreakdown(mint),
  ];
  if (!deltas.deltas) errors.push(`deltas: ${deltas.error}`);
  if (!breakdowns.data) errors.push(`breakdowns: ${breakdowns.error}`);
  if (!stats.data) errors.push(`stats: ${stats.error}`);
  if (!pnl.data) errors.push(`pnl: ${pnl.error}`);
  if (!wallets.data) errors.push(`wallet-categories: ${wallets.error}`);
  if (!supplyBreakdown.data) errors.push(`supply-breakdown: ${supplyBreakdown.error}`);
  return {
    mint,
    ts,
    holders: top.data.holderCount,
    priceUsd: ctx.priceUsd,
    marketCapUsd: ctx.marketCapUsd,
    deltas: deltas.deltas,
    breakdowns: breakdowns.data,
    stats: stats.data,
    pnl: pnl.data,
    wallets: wallets.data,
    supplyBreakdown: supplyBreakdown.data,
    top10Share: share(10),
    top100Share: share(100),
    errors,
  };
}

function toRow(p: HolderProfile) {
  const b = p.breakdowns;
  const s = p.stats;
  const w = p.wallets;
  const sb = p.supplyBreakdown;
  const d = p.deltas;
  return {
    mint: p.mint,
    ts: p.ts,
    holders: p.holders,
    price_usd: p.priceUsd,
    market_cap_usd: p.marketCapUsd,
    d1h: d?.h1 ?? null, d4h: d?.h4 ?? null, d12h: d?.h12 ?? null, d1: d?.d1 ?? null, d3: d?.d3 ?? null, d7: d?.d7 ?? null, d14: d?.d14 ?? null, d30: d?.d30 ?? null,
    over_10: b?.over10 ?? null, over_100: b?.over100 ?? null, over_1k: b?.over1k ?? null, over_10k: b?.over10k ?? null, over_100k: b?.over100k ?? null, over_1m: b?.over1m ?? null,
    shrimp: b?.shrimp ?? null, crab: b?.crab ?? null, fish: b?.fish ?? null, dolphin: b?.dolphin ?? null, whale: b?.whale ?? null,
    hhi: s?.hhi ?? null, gini: s?.gini ?? null, median_position: s?.medianPosition ?? null, avg_time_held_sec: s?.avgTimeHeldSec ?? null, retention_rate: s?.retentionRate ?? null,
    break_even_price: p.pnl?.breakEvenPrice ?? null, realized_pnl_usd: p.pnl?.realizedPnlUsd ?? null, unrealized_pnl_usd: p.pnl?.unrealizedPnlUsd ?? null,
    wc_diamond: w?.diamond ?? null, wc_gold: w?.gold ?? null, wc_silver: w?.silver ?? null, wc_bronze: w?.bronze ?? null, wc_wood: w?.wood ?? null, wc_new: w?.newHolders ?? null,
    sb_diamond: sb?.diamond ?? null, sb_gold: sb?.gold ?? null, sb_silver: sb?.silver ?? null, sb_bronze: sb?.bronze ?? null, sb_wood: sb?.wood ?? null,
    top10_share: p.top10Share,
    top100_share: p.top100Share,
    errors: p.errors.length ? p.errors.join(" · ") : null,
  };
}

type Row = ReturnType<typeof toRow>;

function fromRow(r: Row): HolderProfile {
  const n = (v: number | null | undefined) => (typeof v === "number" ? v : null);
  const has = (...vs: (number | null | undefined)[]) => vs.some((v) => typeof v === "number");
  return {
    mint: r.mint,
    ts: r.ts,
    holders: r.holders,
    priceUsd: n(r.price_usd),
    marketCapUsd: n(r.market_cap_usd),
    deltas: has(r.d1, r.d7, r.d30) ? { h1: n(r.d1h), h4: n(r.d4h), h12: n(r.d12h), d1: n(r.d1), d3: n(r.d3), d7: n(r.d7), d14: n(r.d14), d30: n(r.d30) } : null,
    breakdowns: has(r.over_1k)
      ? { total: r.holders, over10: r.over_10 ?? 0, over100: r.over_100 ?? 0, over1k: r.over_1k ?? 0, over10k: r.over_10k ?? 0, over100k: r.over_100k ?? 0, over1m: r.over_1m ?? 0, shrimp: r.shrimp ?? 0, crab: r.crab ?? 0, fish: r.fish ?? 0, dolphin: r.dolphin ?? 0, whale: r.whale ?? 0 }
      : null,
    stats: has(r.hhi, r.gini, r.median_position) ? { hhi: n(r.hhi), gini: n(r.gini), medianPosition: n(r.median_position), avgTimeHeldSec: n(r.avg_time_held_sec), retentionRate: n(r.retention_rate) } : null,
    pnl: has(r.break_even_price, r.realized_pnl_usd, r.unrealized_pnl_usd) ? { breakEvenPrice: n(r.break_even_price), realizedPnlUsd: n(r.realized_pnl_usd), unrealizedPnlUsd: n(r.unrealized_pnl_usd) } : null,
    wallets: has(r.wc_diamond) ? { diamond: r.wc_diamond ?? 0, gold: r.wc_gold ?? 0, silver: r.wc_silver ?? 0, bronze: r.wc_bronze ?? 0, wood: r.wc_wood ?? 0, newHolders: r.wc_new ?? 0 } : null,
    supplyBreakdown: has(r.sb_diamond) ? { diamond: r.sb_diamond ?? 0, gold: r.sb_gold ?? 0, silver: r.sb_silver ?? 0, bronze: r.sb_bronze ?? 0, wood: r.sb_wood ?? 0 } : null,
    top10Share: n(r.top10_share),
    top100Share: n(r.top100_share),
    errors: r.errors ? r.errors.split(" · ") : [],
  };
}

export type ProfileStepResult = { rows: number; holders: number; errors: string[]; skipped: boolean };

// Worker step: read the profile and store it. Skipped (no row) when the key is unset.
export async function runHolderProfile(db: SupabaseClient, ts: string, mint: string, ctx: ProfileContext): Promise<ProfileStepResult> {
  if (!holderscanEnabled()) return { rows: 0, holders: 0, errors: ["HOLDERSCAN_API_KEY not set"], skipped: true };
  const p = await readHolderProfile(mint, ts, ctx);
  if (!p) throw new Error("HolderScan did not answer for the holder count");
  const { error } = await db.from("holderscan_snapshots").insert(toRow(p));
  if (error) throw new Error(`${error.message} (migration 0014 applied?)`);
  return { rows: 1, holders: p.holders, errors: p.errors, skipped: false };
}

export async function pruneHolderProfiles(db: SupabaseClient, retentionDays = HOLDERSCAN_RETENTION_DAYS): Promise<number> {
  const keepAfter = new Date(Date.now() - retentionDays * 864e5).toISOString();
  const { data, error } = await db.rpc("holderscan_snapshots_prune", { keep_after: keepAfter });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

// ---------- reads ----------

export type ProfilePoint = { ts: number; holders: number; over1k: number | null; over10k: number | null; marketCapUsd: number | null };

export type HolderHistory = {
  latest: HolderProfile;
  dayAgo: HolderProfile | null; // newest row at or before 24h before `latest` — null until one exists
  weekAgo: HolderProfile | null;
  series: ProfilePoint[]; // hourly, last 30 days, oldest first
  hoursOfHistory: number;
};

const MIN_COVERAGE = 0.8;

// null when the DB is unset, the table is missing (logged) or nothing has been stored yet. DATA_SOURCE=fixture serves
// src/fixtures/holderscan-stonk.json (a synthetic sample in this shape — the sandbox cannot reach HolderScan) for STONK.
export async function getHolderHistory(mint: string): Promise<HolderHistory | null> {
  if (process.env.DATA_SOURCE === "fixture") {
    if (!mint.startsWith("6GmAFSYs")) return null;
    const mod = await import("@/fixtures/holderscan-stonk.json");
    return (mod.default ?? mod) as unknown as HolderHistory;
  }
  const db = getDb();
  if (!db) return null;
  const last = await db.from("holderscan_snapshots").select("*").eq("mint", mint).order("ts", { ascending: false }).limit(1);
  if (last.error) {
    console.error(`holderscan_snapshots read failed: ${last.error.message} (migration 0014 applied?)`);
    return null;
  }
  if (!last.data?.[0]) return null;
  const latest = fromRow(last.data[0] as Row);
  const at = Date.parse(latest.ts);
  const before = async (hours: number) => {
    const { data } = await db.from("holderscan_snapshots").select("*").eq("mint", mint).lte("ts", new Date(at - hours * 3.6e6).toISOString()).order("ts", { ascending: false }).limit(1);
    return data?.[0] ? fromRow(data[0] as Row) : null;
  };
  const since = new Date(at - 30 * 864e5).toISOString();
  const [dayAgo, weekAgo, first, series] = await Promise.all([
    before(24 * MIN_COVERAGE),
    before(168 * MIN_COVERAGE),
    db.from("holderscan_snapshots").select("ts").eq("mint", mint).order("ts", { ascending: true }).limit(1),
    db.rpc("holderscan_series", { p_mint: mint, since }),
  ]);
  const firstTs = first.data?.[0]?.ts ? Date.parse(first.data[0].ts as string) : at;
  const points: ProfilePoint[] = ((series.data ?? []) as { ts: string; holders: number; over_1k: number | null; over_10k: number | null; market_cap_usd: number | null }[])
    .map((r) => ({ ts: Date.parse(r.ts), holders: r.holders, over1k: r.over_1k, over10k: r.over_10k, marketCapUsd: r.market_cap_usd }))
    .sort((a, b) => a.ts - b.ts);
  return { latest, dayAgo, weekAgo, series: points, hoursOfHistory: (at - firstTs) / 3.6e6 };
}

// Change of one field between two profiles, or null when the earlier one is missing.
export function profileChange(a: HolderProfile | null, b: HolderProfile, pick: (p: HolderProfile) => number | null | undefined): { abs: number; pct: number | null; hours: number } | null {
  if (!a) return null;
  const va = pick(a);
  const vb = pick(b);
  if (typeof va !== "number" || typeof vb !== "number") return null;
  return { abs: vb - va, pct: va > 0 ? ((vb - va) / va) * 100 : null, hours: (Date.parse(b.ts) - Date.parse(a.ts)) / 3.6e6 };
}
