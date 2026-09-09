import "server-only";
import { getRewards, getToken, getTokens, STONK_MINT } from "./api";
import { getDb, getRewardWindows, type RewardWindow } from "./db";
import { getUsdPrices } from "./jupiter";
import type { Token } from "./types";

// Realized holder-fee APR for reward-mode coins.
//
//   APR(window) = (payout tokens over the window × quote USD price now) ÷ market cap now × (8760 ÷ window hours)
//
// Payout tokens come from this site's own reward_snapshots (lifetime distributed tokens per coin,
// every 5 min), so the figure is what holders were actually paid — not trading volume × a fee rate.
// Market cap is the denominator because it is the one figure both the reader and this site can
// verify; a holder's own yield is higher to the extent that ineligible balances (pools, program
// accounts) are excluded from payouts, and lower by whatever the coin's price does.

export const YIELD_MIN_AGE_HOURS = 72;
export const YIELD_ROWS = 10;
const MIN_COVERAGE = 0.8; // a window counts once ≥80% of it is covered by readings

export type AprCell = { apr: number; usd: number; tokens: number; hours: number; from: string; to: string } | null;

export type YieldRow = {
  mint: string;
  symbol: string;
  name: string;
  marketCapUsd: number;
  quoteMint: string;
  quoteSymbol: string;
  quotePriceUsd: number | null;
  transferFeeBps: number | null;
  holderCount: number;
  lastPayoutAt: string;
  createdAt: string;
  d1: AprCell;
  d3: AprCell;
};

export type YieldTable = {
  status: "ok" | "collecting" | "no-db";
  rows: YieldRow[];
  candidates: number; // reward coins old enough, ranked by market cap, before the payout filter
  historyHours: number; // longest span any coin's readings cover
  generatedAt: string;
};

function cell(w: RewardWindow | undefined, winHours: number, price: number | null, mcap: number): AprCell {
  if (!w || price === null || !(mcap > 0)) return null;
  if (w.hours < winHours * MIN_COVERAGE) return null;
  const tokens = Math.max(0, w.toTokens - w.fromTokens);
  const usd = tokens * price;
  return { apr: (usd / mcap) * (8760 / w.hours) * 100, usd, tokens, hours: w.hours, from: w.from, to: w.to };
}

export async function getYieldTable(): Promise<YieldTable> {
  const generatedAt = new Date().toISOString();
  const db = getDb();
  const [byMc, rewards, w24, w72] = await Promise.all([
    getTokens({ mode: "reward", sort: "marketCap", pageSize: 100 }),
    getRewards(),
    db ? getRewardWindows(24) : null,
    db ? getRewardWindows(72) : null,
  ]);
  const launches = new Map(rewards.data.launches.map((l) => [l.mint, l]));
  const cutoff = Date.now() - YIELD_MIN_AGE_HOURS * 3.6e6;
  const tokens: Token[] = byMc.data.tokens
    .filter((t) => t.mode === "reward" && (t.market?.marketCapUsd ?? 0) > 0 && Date.parse(t.createdAt) <= cutoff && launches.has(t.mint))
    .sort((a, b) => (b.market?.marketCapUsd ?? 0) - (a.market?.marketCapUsd ?? 0));

  const quoteMints = [...new Set(tokens.map((t) => launches.get(t.mint)!.quote.mint))];
  const prices = await getUsdPrices(quoteMints);
  if (quoteMints.includes(STONK_MINT)) {
    const s = await getToken(STONK_MINT);
    if (s?.data.token.market?.priceUsd) prices[STONK_MINT] = s.data.token.market.priceUsd;
  }

  let historyHours = 0;
  for (const w of w72?.values() ?? []) historyHours = Math.max(historyHours, w.hours);

  const rows: YieldRow[] = [];
  for (const t of tokens) {
    const l = launches.get(t.mint)!;
    const price = prices[l.quote.mint] ?? null;
    const mcap = t.market!.marketCapUsd!;
    const d1 = cell(w24?.get(t.mint), 24, price, mcap);
    const d3 = cell(w72?.get(t.mint), 72, price, mcap);
    // Yield-paying = at least one recorded payout inside the longer window.
    if (!(d3?.tokens || d1?.tokens)) continue;
    rows.push({
      mint: t.mint,
      symbol: t.symbol,
      name: t.name,
      marketCapUsd: mcap,
      quoteMint: l.quote.mint,
      quoteSymbol: l.quote.symbol,
      quotePriceUsd: price,
      transferFeeBps: t.transferFee?.bps ?? null,
      holderCount: l.holderCount,
      lastPayoutAt: l.lastPayoutAt,
      createdAt: t.createdAt,
      d1,
      d3,
    });
    if (rows.length >= YIELD_ROWS) break;
  }

  return {
    status: !db ? "no-db" : rows.length ? "ok" : "collecting",
    rows,
    candidates: tokens.length,
    historyHours,
    generatedAt,
  };
}
