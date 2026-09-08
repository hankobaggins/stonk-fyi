import "server-only";
import { getRewards, getTokens, STONK_MINT } from "./api";
import { getUsdPrices } from "./jupiter";
import type { RewardDistribution, RewardLaunch, Token } from "./types";

export type RewardRow = RewardLaunch & { usdNow: number | null; symbol?: string; name?: string };
export type QuoteRow = { mint: string; symbol: string; coins: number; payouts: number; tokens: number; usdNow: number | null };
export type DistributionRow = RewardDistribution & { symbol?: string; quoteSymbol?: string; usdNow: number | null };

export type RewardsOverview = {
  generatedAt: string;
  coins: number;
  coinsPaying: number;
  payouts: number;
  holdersPaid: number;
  usdNow: number;
  usdPricedShare: number;
  rows: RewardRow[];
  byQuote: QuoteRow[];
  recent: DistributionRow[];
};

// Lifetime holder rewards across every reward-mode coin, valued at current Jupiter prices.
// "Now" pricing is the honest thing this endpoint allows: StonkFun's own USD-at-payout figure only
// exists as a platform-wide daily total (revenue history), not per coin.
export async function getRewardsOverview(): Promise<RewardsOverview> {
  const [rewards, byVol, byMc] = await Promise.all([
    getRewards(),
    getTokens({ mode: "reward", sort: "volume", pageSize: 100 }),
    getTokens({ mode: "reward", sort: "marketCap", pageSize: 100 }),
  ]);
  const launches = rewards.data.launches;
  const recentRaw = rewards.data.recentDistributions ?? [];
  const names = new Map<string, Token>();
  for (const t of [...byVol.data.tokens, ...byMc.data.tokens]) names.set(t.mint, t);

  const quoteMints = new Set<string>();
  for (const l of launches) quoteMints.add(l.quote.mint);
  for (const d of recentRaw) quoteMints.add(d.quoteMint);
  const prices = await getUsdPrices([...quoteMints]);
  // STONK-quoted coins: StonkFun's own price is the reference on this site.
  const stonk = [...names.values()].find((t) => t.mint === STONK_MINT);
  if (stonk?.market?.priceUsd) prices[STONK_MINT] = stonk.market.priceUsd;

  const rows: RewardRow[] = launches.map((l) => {
    const p = prices[l.quote.mint];
    const t = names.get(l.mint);
    return { ...l, usdNow: p !== undefined ? l.distributedTokens * p : null, symbol: t?.symbol, name: t?.name };
  });
  rows.sort((a, b) => (b.usdNow ?? -1) - (a.usdNow ?? -1) || b.payoutCount - a.payoutCount);

  const quoteMap = new Map<string, QuoteRow>();
  for (const r of rows) {
    const q = quoteMap.get(r.quote.mint) ?? { mint: r.quote.mint, symbol: r.quote.symbol, coins: 0, payouts: 0, tokens: 0, usdNow: prices[r.quote.mint] !== undefined ? 0 : null };
    q.coins += 1;
    q.payouts += r.payoutCount;
    q.tokens += r.distributedTokens;
    if (q.usdNow !== null && r.usdNow !== null) q.usdNow += r.usdNow;
    quoteMap.set(r.quote.mint, q);
  }
  const byQuote = [...quoteMap.values()].sort((a, b) => (b.usdNow ?? -1) - (a.usdNow ?? -1) || b.payouts - a.payouts);

  const quoteSymbol = new Map<string, string>();
  for (const l of launches) quoteSymbol.set(l.quote.mint, l.quote.symbol);
  const recent: DistributionRow[] = recentRaw.map((d) => {
    const p = prices[d.quoteMint];
    return { ...d, symbol: names.get(d.mint)?.symbol, quoteSymbol: quoteSymbol.get(d.quoteMint), usdNow: p !== undefined ? d.amountTokens * p : null };
  });

  const usdNow = rows.reduce((s, r) => s + (r.usdNow ?? 0), 0);
  const pricedPayouts = rows.filter((r) => r.usdNow !== null).reduce((s, r) => s + r.payoutCount, 0);
  const payouts = rows.reduce((s, r) => s + r.payoutCount, 0);
  return {
    generatedAt: rewards.meta?.generatedAt ?? new Date().toISOString(),
    coins: rows.length,
    coinsPaying: rows.filter((r) => r.payoutCount > 0).length,
    payouts,
    holdersPaid: rows.reduce((s, r) => s + r.holderCount, 0),
    usdNow,
    usdPricedShare: payouts ? pricedPayouts / payouts : 0,
    rows,
    byQuote,
    recent,
  };
}
