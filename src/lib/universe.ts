import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPairs, getRewards } from "./api";
import { getDb } from "./db";
import { getHolderscanDeltas, getHolderscanHolderCount, HOLDERSCAN_ADVANCED, holderscanEnabled } from "./holderscan";
import type { Pair, RewardLaunch } from "./types";

// The whole universe of quote assets (CLAUDE.md §6g): every StonkFun pair with at least one reward-mode
// coin launched against it, in every category — stock issuers, crypto/custom, currencies, SOL, leverage,
// collectibles. Two readings per asset:
//   holders      HolderScan holder_count, once a day — hourly on the Advanced plan (worker step `universe_holders`,
//                quote_holder_snapshots)
//   paid wallets distinct wallets holding any reward coin quoted in the asset, from the daily reward-coin
//                census (lib/wallets.ts runCoinCensus, coin_census_quotes). A lower bound: the census covers
//                the largest coins by holder count up to a page budget, and says how much it covers.
// The two are different providers and different measures (any balance vs. any covered-coin balance);
// the page keeps them in separate columns and shows their ratio as "share".

export const UNIVERSE_RETENTION_DAYS = 60;
const MIN_COVERAGE = 0.8;

export const CATEGORY_LABELS: Record<string, string> = {
  xstock: "xStocks",
  backpack: "Backpack",
  prestock: "Pre-stocks",
  tessera: "Tessera",
  custom: "Crypto",
  currency: "Stablecoins",
  solana: "Solana",
  leverage: "Leverage",
  collectible: "Collectibles",
  other: "Other",
};
export const CATEGORY_ORDER = ["xstock", "backpack", "prestock", "tessera", "custom", "currency", "solana", "leverage", "collectible"];
export const categoryLabel = (c: string | undefined, fallback?: string) => (c && CATEGORY_LABELS[c]) || fallback || c || "other";

export type UniverseAsset = Pair & { category: string; coins: number; slots: number; launches: RewardLaunch[] };

// Pairs joined with the rewards ledger; only assets with ≥1 reward coin. `slots` = Σ holderCount of the
// coins quoted in the asset (StonkFun's reward-eligible wallets, one slot per coin per wallet — not
// distinct wallets; the census gives those).
export async function getUniverse(): Promise<{ assets: UniverseAsset[]; launches: RewardLaunch[] }> {
  const [pairs, rewards] = await Promise.all([getPairs(), getRewards()]);
  const launches = rewards.data.launches;
  const byQuote = new Map<string, RewardLaunch[]>();
  for (const l of launches) {
    const arr = byQuote.get(l.quote.mint);
    if (arr) arr.push(l);
    else byQuote.set(l.quote.mint, [l]);
  }
  const assets: UniverseAsset[] = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    const ls = byQuote.get(p.mint);
    if (!ls || seen.has(p.mint)) continue;
    seen.add(p.mint);
    assets.push({ ...p, category: p.category ?? "custom", coins: ls.length, slots: ls.reduce((a, l) => a + l.holderCount, 0), launches: ls });
  }
  // Quote assets the rewards ledger knows but /pairs no longer lists (delisted): keep them, uncategorised.
  for (const [mint, ls] of byQuote) {
    if (seen.has(mint)) continue;
    assets.push({ mint, symbol: ls[0].quote.symbol, category: "other", coins: ls.length, slots: ls.reduce((a, l) => a + l.holderCount, 0), launches: ls });
  }
  assets.sort((a, b) => b.slots - a.slots);
  return { assets, launches };
}

// ---------- worker step: HolderScan holder count per universe asset ----------

export type UniverseStepResult = { rows: number; read: number; failed: number; skipped: boolean; firstError: string | null };

export async function runUniverseHolders(db: SupabaseClient, ts: string): Promise<UniverseStepResult> {
  if (!holderscanEnabled()) return { rows: 0, read: 0, failed: 0, skipped: true, firstError: "HOLDERSCAN_API_KEY not set" };
  const { assets } = await getUniverse();
  let firstError: string | null = null;
  const rows: { mint: string; ts: string; category: string; holders: number; source: string }[] = [];
  let failed = 0;
  for (const a of assets) {
    const r = await getHolderscanHolderCount(a.mint); // paced inside the client
    if (r.holders === null) {
      failed++;
      if (!firstError) firstError = `${a.symbol}: ${r.error}`;
      continue;
    }
    rows.push({ mint: a.mint, ts, category: a.category, holders: r.holders, source: "holderscan" });
  }
  if (rows.length) {
    const { error } = await db.from("quote_holder_snapshots").upsert(rows, { onConflict: "mint,ts" });
    if (error) throw new Error(error.message);
  } else if (assets.length) {
    throw new Error(`no universe asset could be read (${firstError})`);
  }
  return { rows: rows.length, read: rows.length, failed, skipped: false, firstError };
}

// The :15 tick (minute 15–19), its own slot: every hour on the Advanced plan (~325 × 10 units × 24 × 30 ≈ 2.3M a
// month of 15M), once a day at 02:15 UTC on Standard (≈ 96K of 200K).
export const UNIVERSE_EVERY_H = Math.max(1, Number(process.env.UNIVERSE_EVERY_H ?? (HOLDERSCAN_ADVANCED ? 1 : 24)));
export function universeDue(ts: string): boolean {
  const d = new Date(ts);
  const m = d.getUTCMinutes();
  return m >= 15 && m < 20 && (UNIVERSE_EVERY_H >= 24 ? d.getUTCHours() === 2 : d.getUTCHours() % UNIVERSE_EVERY_H === 0);
}

// HolderScan's own 1d…30-day deltas on the 02:15 tick: every day on the Advanced plan (20 units a call, ~6.5K a
// run), every fourth day on Standard (~49K a month on top of the daily counts, inside the plan's 200K).
export const DELTAS_EVERY_DAYS = Math.max(1, Number(process.env.UNIVERSE_DELTAS_EVERY_DAYS ?? (HOLDERSCAN_ADVANCED ? 1 : 4)));
export function deltasDue(ts: string): boolean {
  const d = new Date(ts);
  const m = d.getUTCMinutes();
  return m >= 15 && m < 20 && d.getUTCHours() === 2 && Math.floor(Date.parse(ts) / 864e5) % DELTAS_EVERY_DAYS === 0;
}

export type DeltasStepResult = { rows: number; failed: number; skipped: boolean; firstError: string | null };

export async function runUniverseDeltas(db: SupabaseClient, ts: string): Promise<DeltasStepResult> {
  if (!holderscanEnabled()) return { rows: 0, failed: 0, skipped: true, firstError: "HOLDERSCAN_API_KEY not set" };
  const { assets } = await getUniverse();
  let firstError: string | null = null;
  let failed = 0;
  const rows: { mint: string; ts: string; d1: number | null; d3: number | null; d7: number | null; d14: number | null; d30: number | null }[] = [];
  for (const a of assets) {
    const r = await getHolderscanDeltas(a.mint);
    if (!r.deltas) {
      failed++;
      if (!firstError) firstError = `${a.symbol}: ${r.error}`;
      continue;
    }
    const { d1, d3, d7, d14, d30 } = r.deltas;
    rows.push({ mint: a.mint, ts, d1, d3, d7, d14, d30 });
  }
  if (rows.length) {
    const { error } = await db.from("quote_holder_deltas").upsert(rows, { onConflict: "mint,ts" });
    if (error) throw new Error(error.message);
  } else if (assets.length) {
    throw new Error(`no deltas could be read (${firstError})`);
  }
  return { rows: rows.length, failed, skipped: false, firstError };
}

// ---------- reward-coin deltas (HolderScan, per coin) ----------

export const COIN_DELTAS_TOP = Math.max(10, Number(process.env.COIN_DELTAS_TOP ?? 250));

export type CoinDeltasStepResult = { rows: number; failed: number; skipped: boolean; firstError: string | null; slotsCovered: number; slotsTotal: number };

// HolderScan deltas for the COIN_DELTAS_TOP largest reward coins by StonkFun holderCount (20 units each).
// Runs with the quote-asset deltas (every DELTAS_EVERY_DAYS days) or on demand with ?coindeltas=1.
export async function runCoinDeltas(db: SupabaseClient, ts: string, top = COIN_DELTAS_TOP): Promise<CoinDeltasStepResult> {
  if (!holderscanEnabled()) return { rows: 0, failed: 0, skipped: true, firstError: "HOLDERSCAN_API_KEY not set", slotsCovered: 0, slotsTotal: 0 };
  const launches = (await getRewards()).data.launches;
  const slotsTotal = launches.reduce((a, l) => a + l.holderCount, 0);
  const picked = [...launches].filter((l) => l.holderCount > 0).sort((a, b) => b.holderCount - a.holderCount).slice(0, top);
  let firstError: string | null = null;
  let failed = 0;
  let slotsCovered = 0;
  const rows: { mint: string; ts: string; quote_mint: string; holders_now: number; d1: number | null; d3: number | null; d7: number | null; d14: number | null; d30: number | null }[] = [];
  for (const l of picked) {
    const r = await getHolderscanDeltas(l.mint);
    if (!r.deltas) {
      failed++;
      if (!firstError) firstError = `${l.mint.slice(0, 6)}… (${l.quote.symbol}, ${l.holderCount} holders): ${r.error}`;
      continue;
    }
    slotsCovered += l.holderCount;
    const { d1, d3, d7, d14, d30 } = r.deltas;
    rows.push({ mint: l.mint, ts, quote_mint: l.quote.mint, holders_now: l.holderCount, d1, d3, d7, d14, d30 });
  }
  if (rows.length) {
    const { error } = await db.from("coin_holder_deltas").upsert(rows, { onConflict: "mint,ts" });
    if (error) throw new Error(error.message);
  } else if (picked.length) {
    throw new Error(`no coin deltas could be read (${firstError})`);
  }
  return { rows: rows.length, failed, skipped: false, firstError, slotsCovered, slotsTotal };
}

export type CoinDeltaTotals = {
  ts: string;
  coins: number; // coins with a delta in the newest run
  holdersNow: number; // Σ StonkFun holderCount over those coins
  d1: number | null; // null until a run stored the 1-day figure (migration 0014)
  d7: number;
  d14: number;
  d30: number;
  byQuote: Map<string, { coins: number; d7: number; d30: number }>;
};

// Newest run of coin_holder_deltas, summed. null when the table is empty or unreadable.
export async function getCoinDeltaTotals(): Promise<CoinDeltaTotals | null> {
  const db = getDb();
  if (!db) return null;
  const last = await db.from("coin_holder_deltas").select("ts").order("ts", { ascending: false }).limit(1);
  if (last.error || !last.data?.[0]) {
    if (last.error) console.error(`coin_holder_deltas read failed: ${last.error.message} (migration 0013 applied?)`);
    return null;
  }
  const ts = last.data[0].ts as string;
  const { data, error } = await db.from("coin_holder_deltas").select("mint, quote_mint, holders_now, d1, d7, d14, d30").eq("ts", ts).limit(5000);
  if (error || !data) return null;
  const t: CoinDeltaTotals = { ts, coins: data.length, holdersNow: 0, d1: data.some((r) => typeof r.d1 === "number") ? 0 : null, d7: 0, d14: 0, d30: 0, byQuote: new Map() };
  for (const r of data) {
    t.holdersNow += r.holders_now;
    if (t.d1 !== null) t.d1 += r.d1 ?? 0;
    t.d7 += r.d7 ?? 0;
    t.d14 += r.d14 ?? 0;
    t.d30 += r.d30 ?? 0;
    const q = t.byQuote.get(r.quote_mint) ?? { coins: 0, d7: 0, d30: 0 };
    q.coins++;
    q.d7 += r.d7 ?? 0;
    q.d30 += r.d30 ?? 0;
    t.byQuote.set(r.quote_mint, q);
  }
  return t;
}

export type CoinHolderDelta = { ts: string; holdersNow: number; d1: number | null; d7: number | null; d14: number | null; d30: number | null };

// Newest HolderScan delta row for one reward coin (token detail page); null when none or on a DB error.
export async function getCoinHolderDelta(mint: string): Promise<CoinHolderDelta | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.from("coin_holder_deltas").select("ts, holders_now, d1, d7, d14, d30").eq("mint", mint).order("ts", { ascending: false }).limit(1);
  if (error || !data?.[0]) return null;
  const r = data[0];
  return { ts: r.ts, holdersNow: r.holders_now, d1: r.d1 ?? null, d7: r.d7 ?? null, d14: r.d14 ?? null, d30: r.d30 ?? null };
}

export type LatestDeltas = Map<string, { ts: string; d1: number | null; d7: number | null; d14: number | null; d30: number | null }>;

// Newest HolderScan delta row per mint from the last `maxAgeDays` days; null on a DB error.
export async function getLatestDeltas(maxAgeDays = 2 * DELTAS_EVERY_DAYS + 1): Promise<LatestDeltas | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - maxAgeDays * 864e5).toISOString();
  const { data, error } = await db.from("quote_holder_deltas").select("mint, ts, d1, d7, d14, d30").gte("ts", since).order("ts", { ascending: false }).limit(3000);
  if (error) {
    console.error(`quote_holder_deltas read failed: ${error.message} (migration 0012 applied?)`);
    return null;
  }
  const out: LatestDeltas = new Map();
  for (const r of data ?? []) if (!out.has(r.mint)) out.set(r.mint, r);
  return out;
}

export async function pruneUniverseHolders(db: SupabaseClient, retentionDays = UNIVERSE_RETENTION_DAYS): Promise<number> {
  const keepAfter = new Date(Date.now() - retentionDays * 864e5).toISOString();
  const { data, error } = await db.rpc("quote_holder_snapshots_prune", { keep_after: keepAfter });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

// ---------- reads ----------

export type Window = { from: string; to: string; fromHolders: number; toHolders: number; hours: number };
export type Change = { abs: number; pct: number | null; hours: number; from: string; to: string; provider?: "holderscan" } | null;

export async function getQuoteHolderWindows(winHours: number, mints: string[]): Promise<Map<string, Window> | null> {
  const db = getDb();
  if (!db) return null;
  const out = new Map<string, Window>();
  if (!mints.length) return out;
  const { data, error } = await db.rpc("quote_holder_window", { win_hours: winHours, mints });
  if (error || !data) {
    console.error(`quote_holder_window(${winHours}h, ${mints.length} mints) failed: ${error?.message ?? "no data"} (migration 0011 applied?)`);
    return null;
  }
  for (const r of data as { mint: string; from_ts: string; to_ts: string; from_holders: number; to_holders: number }[]) {
    out.set(r.mint, { from: r.from_ts, to: r.to_ts, fromHolders: r.from_holders, toHolders: r.to_holders, hours: (Date.parse(r.to_ts) - Date.parse(r.from_ts)) / 3.6e6 });
  }
  return out;
}

// HolderScan's own delta as a Change, used for a window this site's readings do not cover yet.
// pct is against the count at the window start (holders now − delta).
export function deltaChange(abs: number | null | undefined, holders: number | null, days: number, at: string): Change {
  if (abs === null || abs === undefined || holders === null) return null;
  const base = holders - abs;
  return { abs, pct: base > 0 ? (abs / base) * 100 : null, hours: days * 24, from: new Date(Date.parse(at) - days * 864e5).toISOString(), to: at, provider: "holderscan" };
}

export function change(w: Window | undefined, winHours: number): Change {
  if (!w || w.hours < winHours * MIN_COVERAGE) return null;
  const abs = w.toHolders - w.fromHolders;
  return { abs, pct: w.fromHolders > 0 ? (abs / w.fromHolders) * 100 : null, hours: w.hours, from: w.from, to: w.to };
}

export type CoinCensusRun = {
  ts: string;
  wallets: number;
  coins: number;
  coinsTotal: number;
  slotsCovered: number;
  slotsTotal: number;
  accounts: number;
  coinsFailed: number;
  firstError: string | null;
  durationMs: number | null;
};
export type CoinCensusQuote = { wallets: number; coins: number; coinsTotal: number };
export type CoinCensus = {
  status: "ok" | "empty" | "no-db" | "db-error";
  runs: CoinCensusRun[]; // ascending, last `days`
  latest: CoinCensusRun | null;
  quotes: Map<string, CoinCensusQuote>; // newest run, by quote mint
  prev: Map<string, { ts: string; wallets: number }>; // per quote mint: the newest run at or before 24h ago
  categories: Map<string, { wallets: number; coins: number; d1: number | null }>; // newest run, de-duplicated within each category
};

export async function getCoinCensus(days = 31): Promise<CoinCensus> {
  const db = getDb();
  const empty = (status: CoinCensus["status"]): CoinCensus => ({ status, runs: [], latest: null, quotes: new Map(), prev: new Map(), categories: new Map() });
  if (!db) return empty("no-db");
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const runsQ = await db.from("coin_census_runs").select("*").gte("ts", since).order("ts", { ascending: true }).limit(2000);
  if (runsQ.error) {
    console.error(`coin_census_runs read failed: ${runsQ.error.message} (migration 0011 applied?)`);
    return empty("db-error");
  }
  const runs: CoinCensusRun[] = (runsQ.data ?? []).map((r) => ({
    ts: r.ts,
    wallets: r.wallets,
    coins: r.coins,
    coinsTotal: r.coins_total,
    slotsCovered: r.slots_covered,
    slotsTotal: r.slots_total,
    accounts: r.accounts,
    coinsFailed: r.coins_failed,
    firstError: r.first_error,
    durationMs: r.duration_ms,
  }));
  if (!runs.length) return empty("empty");
  const latest = runs[runs.length - 1];
  const dayAgo = Date.parse(latest.ts) - 24 * 3.6e6;
  let prevRun: CoinCensusRun | null = null;
  for (const r of runs) if (Date.parse(r.ts) <= dayAgo) prevRun = r;
  const tsList = prevRun ? [latest.ts, prevRun.ts] : [latest.ts];
  const [qQ, cQ] = await Promise.all([
    db.from("coin_census_quotes").select("ts, quote_mint, wallets, coins, coins_total").in("ts", tsList).limit(2000),
    db.from("coin_census_categories").select("ts, category, wallets, coins").in("ts", tsList).limit(100),
  ]);
  if (qQ.error || cQ.error) {
    console.error(`coin_census_quotes/categories read failed: ${qQ.error?.message ?? cQ.error?.message}`);
    return empty("db-error");
  }
  const categories = new Map<string, { wallets: number; coins: number; d1: number | null }>();
  const prevCat = new Map<string, number>();
  for (const r of cQ.data ?? []) {
    if (r.ts === latest.ts) categories.set(r.category, { wallets: r.wallets, coins: r.coins, d1: null });
    else prevCat.set(r.category, r.wallets);
  }
  for (const [k, v] of categories) if (prevCat.has(k)) v.d1 = v.wallets - prevCat.get(k)!;
  const quotes = new Map<string, CoinCensusQuote>();
  const prev = new Map<string, { ts: string; wallets: number }>();
  for (const r of qQ.data ?? []) {
    if (r.ts === latest.ts) quotes.set(r.quote_mint, { wallets: r.wallets, coins: r.coins, coinsTotal: r.coins_total });
    else prev.set(r.quote_mint, { ts: r.ts, wallets: r.wallets });
  }
  return { status: "ok", runs, latest, quotes, prev, categories };
}

// ---------- the page's rows ----------

export type UniverseRow = {
  mint: string;
  symbol: string;
  name: string;
  category: string;
  categoryLabel: string;
  logoUrl?: string;
  coins: number; // reward coins quoted in it
  slots: number; // Σ StonkFun holderCount over those coins
  holders: number | null; // HolderScan, newest reading
  readAt: string | null;
  d1: Change;
  d7: Change;
  d30: Change;
  paid: number | null; // census: distinct wallets holding any covered coin quoted in it
  paidD1: number | null; // vs the run ≥24h earlier
  paidCoins: number | null; // covered coins
  share: number | null; // paid / holders
};

export type UniverseTable = {
  status: "ok" | "collecting" | "no-db" | "db-error";
  rows: UniverseRow[];
  readCount: number; // rows with a HolderScan reading
  deltaCount: number; // rows whose 7d/30d come from HolderScan's own deltas
  historyHours: number;
  census: CoinCensus;
  coinDeltas: CoinDeltaTotals | null;
  generatedAt: string;
};

export async function getUniverseTable(): Promise<UniverseTable> {
  const generatedAt = new Date().toISOString();
  const db = getDb();
  const [{ assets }, census, deltas, coinDeltas] = await Promise.all([getUniverse(), getCoinCensus(), getLatestDeltas(), getCoinDeltaTotals()]);
  const mints = assets.map((a) => a.mint);
  const [w24, w168, w720] = db ? await Promise.all([getQuoteHolderWindows(24, mints), getQuoteHolderWindows(168, mints), getQuoteHolderWindows(720, mints)]) : [null, null, null];
  const dbError = !!db && (w24 === null || w168 === null || w720 === null);
  let historyHours = 0;
  for (const w of w720?.values() ?? []) historyHours = Math.max(historyHours, w.hours);

  const rows: UniverseRow[] = assets.map((a) => {
    const latest = w720?.get(a.mint) ?? w24?.get(a.mint);
    const holders = latest?.toHolders ?? null;
    const q = census.quotes.get(a.mint);
    const p = census.prev.get(a.mint);
    const dl = deltas?.get(a.mint);
    // A 1-day figure read more than 36h ago describes a window that has since moved on; 7d / 30d tolerate the lag.
    const d1Fresh = dl && Date.now() - Date.parse(dl.ts) < 36 * 3.6e6;
    return {
      mint: a.mint,
      symbol: a.symbol,
      name: a.name ?? a.symbol,
      category: a.category,
      categoryLabel: categoryLabel(a.category, a.categoryLabel),
      logoUrl: a.logoUrl,
      coins: a.coins,
      slots: a.slots,
      holders,
      readAt: latest?.to ?? null,
      d1: change(w24?.get(a.mint), 24) ?? (d1Fresh ? deltaChange(dl.d1, holders, 1, dl.ts) : null),
      d7: change(w168?.get(a.mint), 168) ?? deltaChange(deltas?.get(a.mint)?.d7, holders, 7, deltas?.get(a.mint)?.ts ?? generatedAt),
      d30: change(w720?.get(a.mint), 720) ?? deltaChange(deltas?.get(a.mint)?.d30, holders, 30, deltas?.get(a.mint)?.ts ?? generatedAt),
      paid: q?.wallets ?? null,
      paidD1: q && p ? q.wallets - p.wallets : null,
      paidCoins: q?.coins ?? null,
      share: q && holders ? q.wallets / holders : null,
    };
  });
  const readCount = rows.filter((r) => r.holders !== null).length;
  const deltaCount = rows.filter((r) => r.d1?.provider === "holderscan" || r.d7?.provider === "holderscan" || r.d30?.provider === "holderscan").length;
  return {
    status: !db ? "no-db" : dbError || census.status === "db-error" ? "db-error" : readCount || census.status === "ok" ? "ok" : "collecting",
    rows,
    readCount,
    deltaCount,
    historyHours,
    census,
    coinDeltas,
    generatedAt,
  };
}
