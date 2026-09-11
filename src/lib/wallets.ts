import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "./db";
import { getMintOwners } from "./helius";
import { getStockQuoteAssets, STOCK_CATEGORIES, type StockCategory } from "./holders";

// Wallet census: distinct wallets holding at least one stock-quoted quote asset, by issuer category
// (migration 0010, CLAUDE.md §6f). One Helius DAS pull per quote asset, reduced to a per-wallet
// bitmask of the categories held, stored as a 15-row histogram per run. No address is stored.

export const WALLET_CENSUS_EVERY_H = Math.max(1, Number(process.env.WALLET_CENSUS_EVERY_H ?? 6));
export const WALLET_HISTORY_DAYS = 31;

export const categoryBit = (c: StockCategory) => 1 << STOCK_CATEGORIES.indexOf(c);

export type CensusResult = { ts: string; wallets: number; accounts: number; mintsOk: number; mintsFailed: number; firstError: string | null; durationMs: number };

export async function runWalletCensus(db: SupabaseClient, ts: string): Promise<CensusResult> {
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
