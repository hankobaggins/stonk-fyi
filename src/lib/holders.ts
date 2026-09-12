import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPairs, getRewards, getTokens } from "./api";
import { getDb, getHolderWindows, type HolderWindow } from "./db";
import { getGmgnHolderCount } from "./gmgn";
import { getHolderscanHolderCount, holderscanEnabled } from "./holderscan";
import type { Pair, RewardLaunch, Token } from "./types";

// Unique holders of the stock-quoted side of StonkFun: the tokenized-stock quote assets themselves
// (xStocks, Backpack, pre-stocks, Tessera) and the largest reward-mode coins launched against them,
// with the change over 24h and 7d. Readings come from this site's own hourly holder_snapshots
// (migration 0009, worker step `holders` in hourly mode):
//   quote assets  HolderScan `holder_count` when HOLDERSCAN_API_KEY is set (one 10-unit call per mint, ~80 an hour;
//                 §6h), else GMGN token info `holder_count`. A mint HolderScan does not track falls back to GMGN;
//                 each reading carries its `source`, and holder_window() (0014) only compares readings of the
//                 same source, so the switch never shows as a step change.
//   coins         StonkFun's `holderCount` in /rewards (one call), so only reward-mode coins can be
//                 listed — standard-mode coins have no holder figure in the API and are not tracked.
// Both counts are "wallets holding any balance" as the provider defines it; they are not the same
// measure and the page says so.

export const STOCK_CATEGORIES = ["xstock", "backpack", "prestock", "tessera"] as const;
export type StockCategory = (typeof STOCK_CATEGORIES)[number];
export const HOLDERS_TRACKED = 100; // reward coins by market cap across the stock categories
export const HOLDERS_RETENTION_DAYS = 14;
const MIN_COVERAGE = 0.8; // a window counts once readings cover ≥80% of it

export const CATEGORY_LABEL: Record<string, string> = { xstock: "xStocks", backpack: "Backpack", prestock: "Pre-stocks", tessera: "Tessera" };

export type Change = { abs: number; pct: number | null; hours: number; from: string; to: string } | null;

export type QuoteHolderRow = {
  mint: string;
  source: "holderscan" | "gmgn" | null; // provider of the newest reading
  symbol: string;
  name: string;
  category: string;
  categoryLabel: string;
  logoUrl?: string;
  holders: number | null; // newest reading; null when GMGN never answered for this mint
  readAt: string | null;
  d1: Change;
  d7: Change;
};

export type CoinHolderRow = {
  mint: string;
  symbol: string;
  name: string;
  marketCapUsd: number;
  quoteMint: string;
  quoteSymbol: string;
  quoteCategory: string;
  holders: number; // StonkFun holderCount, live
  createdAt: string;
  d1: Change;
  d7: Change;
};

export type HoldersTable = {
  status: "ok" | "collecting" | "no-db" | "db-error";
  quoteSource: "holderscan" | "gmgn" | "mixed" | null; // which provider the quote-asset readings come from
  quotes: QuoteHolderRow[];
  coins: CoinHolderRow[];
  historyHours: number;
  generatedAt: string;
};

export function isStockCategory(c?: string | null): c is StockCategory {
  return !!c && (STOCK_CATEGORIES as readonly string[]).includes(c);
}

// The quote assets to track: every pair StonkFun tags with a stock category.
export async function getStockQuoteAssets(): Promise<Pair[]> {
  const pairs = await getPairs();
  return pairs.filter((p) => isStockCategory(p.category)).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export type StockCoin = { token: Token; launch: RewardLaunch };

// The coins to track: the `n` largest reward-mode coins by market cap whose quote asset is in a stock
// category and that the rewards ledger knows (that is where the holder count comes from). One page
// per category, so ranking is exact within the top 100 of each and near-exact overall.
export async function getStockCoinsByMcap(n = HOLDERS_TRACKED): Promise<StockCoin[]> {
  const [rewards, ...pages] = await Promise.all([
    getRewards(),
    ...STOCK_CATEGORIES.map((category) => getTokens({ mode: "reward", category, sort: "marketCap", page: 1, pageSize: 100 })),
  ]);
  const launches = new Map(rewards.data.launches.map((l) => [l.mint, l]));
  const seen = new Set<string>();
  const out: StockCoin[] = [];
  for (const p of pages) {
    for (const t of p.data.tokens) {
      const launch = launches.get(t.mint);
      if (!launch || t.mode !== "reward" || !isStockCategory(t.quote.category) || seen.has(t.mint) || !((t.market?.marketCapUsd ?? 0) > 0)) continue;
      seen.add(t.mint);
      out.push({ token: t, launch });
    }
  }
  out.sort((a, b) => (b.token.market?.marketCapUsd ?? 0) - (a.token.market?.marketCapUsd ?? 0));
  return out.slice(0, n);
}

// GMGN reads one at a time with a gap between them: the free plan answered only the first 6 of 80
// calls when 3 were in flight with a 150 ms gap (2026-09-10), so ~80 mints now take ~2 minutes.
async function mapLimit<T, R>(items: T[], concurrency: number, gapMs: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export type HoldersStepResult = { rows: number; quotesRead: number; quotesFailed: number; coins: number; firstError: string | null; source: "holderscan" | "gmgn" | "none" };

// Worker step: one reading per tracked mint. Quote assets that GMGN cannot answer for are skipped
// (counted in quotesFailed, first message kept) rather than failing the step.
export async function runHoldersSnapshot(db: SupabaseClient, ts: string): Promise<HoldersStepResult> {
  const [quotes, coins] = await Promise.all([getStockQuoteAssets(), getStockCoinsByMcap(HOLDERS_TRACKED)]);
  let firstError: string | null = null;
  const hs = holderscanEnabled();
  const gmgn = !!process.env.GMGN_API_KEY;
  const quoteReads = hs || gmgn
    ? await mapLimit(quotes, 1, hs ? 0 : 1_200, async (q) => {
        if (hs) {
          const r = await getHolderscanHolderCount(q.mint); // paced inside the client
          if (r.holders !== null) return { mint: q.mint, holders: r.holders, source: "holderscan" };
          if (!gmgn) {
            if (!firstError) firstError = `${q.symbol}: ${r.error}`;
            return { mint: q.mint, holders: null, source: "holderscan" };
          }
        }
        const r = await getGmgnHolderCount(q.mint);
        if (r.error && !firstError) firstError = `${q.symbol}: ${r.error}`;
        if (hs && gmgn) await new Promise((res) => setTimeout(res, 1_200)); // GMGN's own pacing on the fallback path
        return { mint: q.mint, holders: r.holders, source: "gmgn" };
      })
    : [];
  const rows = [
    ...quoteReads.filter((r) => r.holders !== null).map((r) => ({ mint: r.mint, ts, kind: "quote", quote_mint: null, holders: r.holders as number, source: r.source })),
    ...coins.map(({ token, launch }) => ({ mint: token.mint, ts, kind: "coin", quote_mint: launch.quote.mint, holders: launch.holderCount, source: "stonkfun" })),
  ];
  if (rows.length) {
    const { error } = await db.from("holder_snapshots").upsert(rows, { onConflict: "mint,ts" });
    if (error) throw new Error(error.message);
  }
  return { rows: rows.length, quotesRead: quoteReads.filter((r) => r.holders !== null).length, quotesFailed: quoteReads.length - quoteReads.filter((r) => r.holders !== null).length, coins: coins.length, firstError, source: hs ? "holderscan" : gmgn ? "gmgn" : "none" };
}

export function trackedMints(quotes: Pair[], coins: StockCoin[]): string[] {
  return [...quotes.map((q) => q.mint), ...coins.map((c) => c.token.mint)];
}

function change(w: HolderWindow | undefined, winHours: number): Change {
  if (!w || w.hours < winHours * MIN_COVERAGE) return null;
  const abs = w.toHolders - w.fromHolders;
  return { abs, pct: w.fromHolders > 0 ? (abs / w.fromHolders) * 100 : null, hours: w.hours, from: w.from, to: w.to };
}

export async function getHoldersTable(): Promise<HoldersTable> {
  const generatedAt = new Date().toISOString();
  const db = getDb();
  const [quotes, coins] = await Promise.all([getStockQuoteAssets(), getStockCoinsByMcap(HOLDERS_TRACKED)]);
  const mints = trackedMints(quotes, coins);
  const [w24, w168, srcRows] = await Promise.all([
    db ? getHolderWindows(24, mints) : null,
    db ? getHolderWindows(168, mints) : null,
    // Provider of each quote asset's newest reading (the last 3 hours cover the newest hourly run).
    db ? db.from("holder_snapshots").select("mint, source, ts").eq("kind", "quote").gte("ts", new Date(Date.now() - 3 * 3.6e6).toISOString()).order("ts", { ascending: false }).limit(1000) : null,
  ]);
  const dbError = !!db && (w24 === null || w168 === null);
  const sourceOf = new Map<string, "holderscan" | "gmgn">();
  for (const r of srcRows?.data ?? []) if (!sourceOf.has(r.mint) && (r.source === "holderscan" || r.source === "gmgn")) sourceOf.set(r.mint, r.source);

  let historyHours = 0;
  for (const w of w168?.values() ?? []) historyHours = Math.max(historyHours, w.hours);

  const quoteRows: QuoteHolderRow[] = quotes.map((q) => {
    const latest = w168?.get(q.mint) ?? w24?.get(q.mint);
    return {
      mint: q.mint,
      source: sourceOf.get(q.mint) ?? null,
      symbol: q.symbol,
      name: q.name ?? q.symbol,
      category: q.category!,
      categoryLabel: CATEGORY_LABEL[q.category!] ?? q.categoryLabel ?? q.category!,
      logoUrl: q.logoUrl,
      holders: latest?.toHolders ?? null,
      readAt: latest?.to ?? null,
      d1: change(w24?.get(q.mint), 24),
      d7: change(w168?.get(q.mint), 168),
    };
  });

  const coinRows: CoinHolderRow[] = coins.map(({ token: t, launch: l }) => ({
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    marketCapUsd: t.market!.marketCapUsd!,
    quoteMint: l.quote.mint,
    quoteSymbol: l.quote.symbol,
    quoteCategory: t.quote.category!,
    holders: l.holderCount,
    createdAt: t.createdAt,
    d1: change(w24?.get(t.mint), 24),
    d7: change(w168?.get(t.mint), 168),
  }));

  const anyReading = quoteRows.some((r) => r.holders !== null) || coinRows.some((r) => r.d1 || r.d7);
  const sources = new Set(quoteRows.map((r) => r.source).filter(Boolean));
  return {
    status: !db ? "no-db" : dbError ? "db-error" : anyReading ? "ok" : "collecting",
    quoteSource: sources.size > 1 ? "mixed" : sources.size === 1 ? ([...sources][0] as "holderscan" | "gmgn") : null,
    quotes: quoteRows,
    coins: coinRows,
    historyHours,
    generatedAt,
  };
}
