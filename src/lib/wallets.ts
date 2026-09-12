import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPairs, getRewards } from "./api";
import { getDb } from "./db";
import { getMintOwners, HELIUS_PAID } from "./helius";
import { getStockQuoteAssets, STOCK_CATEGORIES, type StockCategory } from "./holders";

// Wallet census: distinct wallets holding at least one stock-quoted quote asset, by issuer category
// (migration 0010, CLAUDE.md §6f). One Helius DAS pull per quote asset, reduced to a per-wallet
// bitmask of the categories held, stored as a 15-row histogram per run. No address is stored.

export const WALLET_CENSUS_EVERY_H = Math.max(1, Number(process.env.WALLET_CENSUS_EVERY_H ?? 6));
export const WALLET_HISTORY_DAYS = 31;

export const categoryBit = (c: StockCategory) => 1 << STOCK_CATEGORIES.indexOf(c);

export type CensusResult = { ts: string; wallets: number; accounts: number; mintsOk: number; mintsFailed: number; firstError: string | null; durationMs: number };

// `budgetMs`: stop walking mints once this much time has passed (the rest count as failed, the run is
// stored and flagged incomplete) so a slow Helius day yields a partial reading instead of a killed function.
export async function runWalletCensus(db: SupabaseClient, ts: string, budgetMs = Infinity): Promise<CensusResult> {
  const t0 = Date.now();
  const quotes = await getStockQuoteAssets();
  const masks = new Map<string, number>();
  const mintRows: { mint: string; ts: string; category: string; owners: number; accounts: number }[] = [];
  let accounts = 0;
  let mintsOk = 0;
  let mintsFailed = 0;
  let firstError: string | null = null;
  for (const q of quotes) {
    const bit = categoryBit(q.category as StockCategory);
    if (Date.now() - t0 > budgetMs) {
      mintsFailed++;
      if (!firstError) firstError = `${q.symbol}: time budget of ${Math.round(budgetMs / 1000)}s used up after ${mintsOk} quote assets`;
      continue;
    }
    try {
      const r = await getMintOwners(q.mint);
      for (const o of r.owners) masks.set(o, (masks.get(o) ?? 0) | bit);
      accounts += r.accounts;
      mintRows.push({ mint: q.mint, ts, category: q.category!, owners: r.owners.size, accounts: r.accounts });
      mintsOk++;
    } catch (e) {
      mintsFailed++;
      if (!firstError) firstError = `${q.symbol}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (!mintsOk) throw new Error(`no quote asset could be read (${firstError})`);

  const hist = new Array<number>(16).fill(0);
  for (const m of masks.values()) hist[m]++;
  const runRows = hist.map((wallets, mask) => ({ ts, mask, wallets })).filter((r) => r.mask > 0 && r.wallets > 0);
  const durationMs = Date.now() - t0;

  const r1 = await db.from("wallet_runs").upsert(runRows, { onConflict: "ts,mask" });
  if (r1.error) throw new Error(r1.error.message);
  const r2 = await db.from("wallet_mint_counts").upsert(mintRows, { onConflict: "mint,ts" });
  if (r2.error) throw new Error(r2.error.message);
  const r3 = await db.from("wallet_run_meta").upsert({ ts, mints_ok: mintsOk, mints_failed: mintsFailed, accounts, first_error: firstError, duration_ms: durationMs }, { onConflict: "ts" });
  if (r3.error) throw new Error(r3.error.message);

  return { ts, wallets: masks.size, accounts, mintsOk, mintsFailed, firstError, durationMs };
}

// Whether this tick should run the census: once every WALLET_CENSUS_EVERY_H hours, on the :45 tick
// (minute 45–49), so it never shares a run with the hourly token walk or the :30 holders step.
export function censusDue(ts: string): boolean {
  const d = new Date(ts);
  const m = d.getUTCMinutes();
  return m >= 45 && m < 50 && d.getUTCHours() % WALLET_CENSUS_EVERY_H === 0;
}

// ---------- reads ----------

export type CensusRun = { ts: string; hist: number[] }; // hist[mask] = wallets, 16 entries
export type CensusMeta = { ts: string; mintsOk: number; mintsFailed: number; accounts: number; firstError: string | null; durationMs: number | null };
export type CensusSeries = { status: "ok" | "empty" | "no-db" | "db-error"; runs: CensusRun[]; latest: CensusMeta | null; quoteAssets: number };

export async function getWalletCensus(days = WALLET_HISTORY_DAYS): Promise<CensusSeries> {
  const db = getDb();
  const quotes = await getStockQuoteAssets();
  if (!db) return { status: "no-db", runs: [], latest: null, quoteAssets: quotes.length };
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const [runs, meta] = await Promise.all([
    db.from("wallet_runs").select("ts, mask, wallets").gte("ts", since).order("ts", { ascending: true }).limit(5000),
    db.from("wallet_run_meta").select("ts, mints_ok, mints_failed, accounts, first_error, duration_ms").order("ts", { ascending: false }).limit(1),
  ]);
  if (runs.error || meta.error) {
    console.error(`wallet census read failed: ${runs.error?.message ?? meta.error?.message} (migration 0010 applied?)`);
    return { status: "db-error", runs: [], latest: null, quoteAssets: quotes.length };
  }
  const byTs = new Map<string, number[]>();
  for (const r of runs.data ?? []) {
    let h = byTs.get(r.ts);
    if (!h) byTs.set(r.ts, (h = new Array<number>(16).fill(0)));
    h[r.mask] = r.wallets;
  }
  const m = meta.data?.[0];
  return {
    status: byTs.size ? "ok" : "empty",
    runs: [...byTs.entries()].map(([ts, hist]) => ({ ts, hist })),
    latest: m ? { ts: m.ts, mintsOk: m.mints_ok, mintsFailed: m.mints_failed, accounts: m.accounts, firstError: m.first_error, durationMs: m.duration_ms } : null,
    quoteAssets: quotes.length,
  };
}

// ---------- reward-coin census (CLAUDE.md §6g) ----------
//
// Distinct wallets holding at least one StonkFun reward coin — the ecosystem's holder base, since every
// such wallet is paid the coin's quote asset — and, per quote asset, the distinct wallets holding any
// coin quoted in it. Sized live on 2026-09-12: 11,768 reward coins, Σ holderCount 1.04M, so a full walk
// is ~12K Helius pages (~2 h at the free plan's pace). Instead the coins are taken largest-first by
// StonkFun holderCount until the estimated page count reaches COIN_CENSUS_MAX_PAGES (≈ the top 450
// coins, ~70% of holder-slots, ~10 min, ~11K credits). The result is a lower bound and is labelled with
// its coverage. Nothing but counts is stored.

// Paid Helius (HELIUS_PLAN set, §6g): 3,000 pages a run at 100 ms ≈ 5 min, ~30K credits — covers ~90% of holder-slots;
// every 6 h that is ~3.6M credits a month (the Developer plan has 10M). Free: 1,100 pages, once a day.
export const COIN_CENSUS_MAX_PAGES = Math.max(50, Number(process.env.COIN_CENSUS_MAX_PAGES ?? (HELIUS_PAID ? 3000 : 1100)));
export const COIN_CENSUS_EVERY_H = Math.max(1, Math.min(24, Number(process.env.COIN_CENSUS_EVERY_H ?? (HELIUS_PAID ? 6 : 24))));
const PAGE = 1000;

export type CoinCensusResult = {
  ts: string;
  wallets: number;
  coins: number;
  coinsTotal: number;
  slotsCovered: number;
  slotsTotal: number;
  accounts: number;
  coinsFailed: number;
  firstError: string | null;
  durationMs: number;
  quotes: number;
};

// Pure: which coins fit the page budget, largest first.
export function pickCoinsForCensus<T extends { holderCount: number }>(launches: T[], maxPages = COIN_CENSUS_MAX_PAGES): T[] {
  const sorted = [...launches].filter((l) => l.holderCount > 0).sort((a, b) => b.holderCount - a.holderCount);
  const out: T[] = [];
  let pages = 0;
  for (const l of sorted) {
    const need = Math.ceil(l.holderCount / PAGE);
    if (pages + need > maxPages) break;
    pages += need;
    out.push(l);
  }
  return out;
}

export async function runCoinCensus(db: SupabaseClient, ts: string, budgetMs = Infinity): Promise<CoinCensusResult> {
  const t0 = Date.now();
  const [rewards, pairs] = await Promise.all([getRewards(), getPairs()]);
  const launches = rewards.data.launches;
  const categoryOf = new Map(pairs.map((p) => [p.mint, p.category ?? "custom"]));
  const picked = pickCoinsForCensus(launches);
  const slotsTotal = launches.reduce((a, l) => a + l.holderCount, 0);
  const all = new Set<string>();
  const byQuote = new Map<string, { owners: Set<string>; coins: number }>();
  const byCategory = new Map<string, { owners: Set<string>; coins: number }>();
  const coinsTotalByQuote = new Map<string, number>();
  for (const l of launches) coinsTotalByQuote.set(l.quote.mint, (coinsTotalByQuote.get(l.quote.mint) ?? 0) + 1);
  let accounts = 0;
  let coins = 0;
  let coinsFailed = 0;
  let slotsCovered = 0;
  let firstError: string | null = null;
  for (const l of picked) {
    if (Date.now() - t0 > budgetMs) {
      coinsFailed++;
      if (!firstError) firstError = `time budget of ${Math.round(budgetMs / 1000)}s used up after ${coins} coins`;
      continue;
    }
    try {
      const r = await getMintOwners(l.mint);
      let q = byQuote.get(l.quote.mint);
      if (!q) byQuote.set(l.quote.mint, (q = { owners: new Set(), coins: 0 }));
      const cat = categoryOf.get(l.quote.mint) ?? "other";
      let c = byCategory.get(cat);
      if (!c) byCategory.set(cat, (c = { owners: new Set(), coins: 0 }));
      for (const o of r.owners) {
        all.add(o);
        q.owners.add(o);
        c.owners.add(o);
      }
      q.coins++;
      c.coins++;
      accounts += r.accounts;
      slotsCovered += l.holderCount;
      coins++;
    } catch (e) {
      coinsFailed++;
      if (!firstError) firstError = `${l.mint.slice(0, 6)}… (${l.quote.symbol}): ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (!coins) throw new Error(`no reward coin could be read (${firstError})`);
  const durationMs = Date.now() - t0;

  const r1 = await db.from("coin_census_runs").upsert(
    { ts, wallets: all.size, coins, coins_total: launches.length, slots_covered: slotsCovered, slots_total: slotsTotal, accounts, coins_failed: coinsFailed, first_error: firstError, duration_ms: durationMs },
    { onConflict: "ts" },
  );
  if (r1.error) throw new Error(r1.error.message);
  const quoteRows = [...byQuote.entries()].map(([quote_mint, q]) => ({ ts, quote_mint, wallets: q.owners.size, coins: q.coins, coins_total: coinsTotalByQuote.get(quote_mint) ?? q.coins }));
  const r2 = await db.from("coin_census_quotes").upsert(quoteRows, { onConflict: "ts,quote_mint" });
  if (r2.error) throw new Error(r2.error.message);
  const catRows = [...byCategory.entries()].map(([category, c]) => ({ ts, category, wallets: c.owners.size, coins: c.coins }));
  const r3 = await db.from("coin_census_categories").upsert(catRows, { onConflict: "ts,category" });
  if (r3.error) throw new Error(r3.error.message);

  return { ts, wallets: all.size, coins, coinsTotal: launches.length, slotsCovered, slotsTotal, accounts, coinsFailed, firstError, durationMs, quotes: quoteRows.length };
}

// On the :15 tick, every COIN_CENSUS_EVERY_H hours starting 01:00 UTC (01:15 daily on the free plan; 01/07/13/19:15
// on a paid one) — away from the :30 holders step, the :45 quote-asset census and the 03:00 full run. The tick
// only kicks the census off (/api/cron/census), so sharing the :15 slot with the HolderScan universe read is fine.
export function coinCensusDue(ts: string): boolean {
  const d = new Date(ts);
  const m = d.getUTCMinutes();
  return m >= 15 && m < 20 && d.getUTCHours() % COIN_CENSUS_EVERY_H === 1 % COIN_CENSUS_EVERY_H;
}
