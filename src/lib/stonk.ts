import { cache } from "react";
import "server-only";
import { getRevenue, getRevenueHistory, getStats, getStonkPriceHistory, getToken, getTokenBurns, getTokens, STONK_MINT } from "./api";
import { getPoolInfo, poolSides } from "./raydium";
import { getGmgnHistory, getPoolFlow } from "./db";
import { getGmgnStonk, type GmgnData } from "./gmgn";
import type { BurnEvent, PoolFlow, PoolInfo, PricePoint, Revenue, RevenueDay, Stats, Token, TokenBurns } from "./types";

// STONK launched 2026-07-23 with a fixed 1B supply; mint and freeze authority are null,
// so supply can only go down. Burned amount comes from the per-mint burn ledger.
export const STONK_INITIAL_SUPPLY = 1_000_000_000;
export const STONK_LAUNCHED_AT = "2026-07-23T19:07:06.749Z";
export const STONK_POOL = "7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49"; // STONK/SPYx Raydium CLMM

export type Signal = "bull" | "neutral" | "bear" | "info";

export type Indicator = {
  key: string;
  label: string;
  value: string;
  detail: string;
  signal: Signal;
  group: "flywheel" | "demand" | "holders" | "platform" | "valuation";
  source?: string;
};

export type StonkData = {
  token: Token;
  burns: TokenBurns | null;
  revenue: Revenue;
  days: RevenueDay[];
  stats: Stats;
  quoted: Token[];
  quotedTotal: number;
  history: PricePoint[] | null;
  pool: PoolInfo | null;
  poolSides: ReturnType<typeof poolSides> | null;
  flow: PoolFlow | null;
  gmgn: GmgnData | null;
  gmgnHistory: Awaited<ReturnType<typeof getGmgnHistory>>;
  projection: { price: number; supply: number; marketCap: number; dailyRevenue: number; buybackShare: number; volume24h: number; quoteDepthUsd: number | null; poolVolume24h: number | null };
  supply: { initial: number; burned: number; burnedPct: number; circulating: number; impliedFromMarket?: number };
  burnRate: { tokensPerHour: number; usdPerHour: number; windowHours: number; sample: number; pctSupplyPerDay: number; annualizedPct: number } | null;
  indicators: Indicator[];
  watch: { label: string; detail: string }[];
  generatedAt: string;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function computeBurnRate(burns: BurnEvent[], supply: number) {
  if (burns.length < 2) return null;
  const sorted = [...burns].sort((a, b) => Date.parse(a.burnedAt) - Date.parse(b.burnedAt));
  const first = Date.parse(sorted[0].burnedAt);
  const last = Date.parse(sorted[sorted.length - 1].burnedAt);
  const hours = Math.max((last - first) / 3.6e6, 1 / 60);
  const tokens = sum(sorted.map((b) => b.amountTokens));
  const usd = sum(sorted.map((b) => b.valueUsdAtBurn));
  const perHour = tokens / hours;
  const pctPerDay = (perHour * 24) / supply;
  return { tokensPerHour: perHour, usdPerHour: usd / hours, windowHours: hours, sample: sorted.length, pctSupplyPerDay: pctPerDay * 100, annualizedPct: pctPerDay * 365 * 100 };
}

async function computeStonkData(): Promise<StonkData> {
  const [tokenRes, burns, revenueRes, historyRes, statsRes, quotedRes, history, pool] = await Promise.all([
    getToken(STONK_MINT),
    getTokenBurns(STONK_MINT),
    getRevenue(),
    getRevenueHistory(),
    getStats(),
    getTokens({ quoteMint: STONK_MINT, sort: "volume", pageSize: 100 }),
    getStonkPriceHistory(90),
    getPoolInfo(STONK_POOL),
  ]);
  if (!tokenRes) throw new Error("STONK token not found in API");
  const token = tokenRes.data.token;
  const launch = tokenRes.data.launch ?? null;
  const m = token.market ?? {};
  const revenue = revenueRes.data;
  const days = historyRes.data.days;
  const stats = statsRes.data;
  const quoted = quotedRes.data.tokens;
  const quotedTotal = quotedRes.data.pagination.total;

  // ---- Supply ----
  const burned = burns?.totals.amountTokens ?? 0;
  const circulating = STONK_INITIAL_SUPPLY - burned;
  const impliedFromMarket = m.priceUsd && m.marketCapUsd ? m.marketCapUsd / m.priceUsd : undefined;
  const supply = { initial: STONK_INITIAL_SUPPLY, burned, burnedPct: (burned / STONK_INITIAL_SUPPLY) * 100, circulating, impliedFromMarket };
  const sides = pool ? poolSides(pool, STONK_MINT, m.priceUsd) : null;
  const [flow, gmgn, gmgnHistory] = await Promise.all([getPoolFlow(STONK_POOL, 24, m.priceUsd), getGmgnStonk(), getGmgnHistory(24)]);
  // A reserve delta over a few minutes is noise, not a 24h flow: only score once the window has real coverage.
  const flowHours = flow ? (new Date(flow.to).getTime() - new Date(flow.from).getTime()) / 3.6e6 : 0;
  const flowReady = flowHours >= 12;
  const burnRate = burns ? computeBurnRate(burns.burns, circulating) : null;

  // ---- Revenue / buyback pressure ----
  const last7 = days.slice(-7);
  const prev7 = days.slice(-14, -7);
  const rev7 = sum(last7.map((d) => d.dailyRevenue));
  const revPrev7 = sum(prev7.map((d) => d.dailyRevenue));
  const rev7Delta = revPrev7 ? ((rev7 - revPrev7) / revPrev7) * 100 : null;
  const protocol7 = sum(last7.map((d) => d.dailyProtocolRevenue));
  const buybackShare = revenue.revenue.totalRevenueUsd ? revenue.revenue.totalBuybackUsd / revenue.revenue.totalRevenueUsd : 0;
  // Buybacks per day over the last 7 days ≈ lifetime buyback share of revenue × 7d revenue / 7.
  const dailyBuyback = (rev7 * buybackShare) / 7;
  void protocol7;
  const buybackVsVolume = m.volume24hUsd ? (dailyBuyback / m.volume24hUsd) * 100 : null;
  const avgBuybackPrice = revenue.revenue.boughtBackTokens ? revenue.revenue.boughtBackValueUsd / revenue.revenue.boughtBackTokens : null;
  const buybackMultiple = avgBuybackPrice && m.priceUsd ? m.priceUsd / avgBuybackPrice : null;

  // ---- Demand: tokens that use STONK as their quote asset ----
  const quotedVolume = sum(quoted.map((t) => t.market?.volume24hUsd ?? 0));
  const quotedMcap = sum(quoted.map((t) => t.market?.marketCapUsd ?? 0));
  const quotedGraduated = quoted.filter((t) => t.status === "graduated").length;
  const quotedNew24h = quoted.filter((t) => Date.now() - Date.parse(t.createdAt) < 86_400_000).length;

  // ---- Valuation context ----
  const daysLive = Math.max(1, (Date.now() - Date.parse(STONK_LAUNCHED_AT)) / 86_400_000);
  const annualizedRevenue = (revenue.revenue.totalRevenueUsd / daysLive) * 365;
  const annualizedRun7 = (rev7 / 7) * 365;
  const psRatio = m.marketCapUsd && annualizedRun7 ? m.marketCapUsd / annualizedRun7 : null;
  const launchMcap = launch?.startMarketCapUsd ?? launch?.targetMarketCapUsd ?? 5000; // STONK launched at a ~$5K market cap
  const launchMultiple = m.marketCapUsd ? m.marketCapUsd / launchMcap : null;
  const fromPeak = m.peakMarketCapUsd && m.marketCapUsd ? ((m.marketCapUsd - m.peakMarketCapUsd) / m.peakMarketCapUsd) * 100 : null;
  const turnover = m.marketCapUsd && m.volume24hUsd ? m.volume24hUsd / m.marketCapUsd : null;

  const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
  const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`);
  const num = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));

  const indicators: Indicator[] = [
    {
      key: "burnrate",
      label: "Burn velocity",
      value: burnRate ? `${burnRate.pctSupplyPerDay.toFixed(2)}% / day` : "—",
      detail: burnRate
        ? `${num(burnRate.tokensPerHour)} STONK/hour over the last ${burnRate.sample} burns (${burnRate.windowHours.toFixed(1)}h) · ${burnRate.annualizedPct.toFixed(0)}% of supply a year at this pace.`
        : "Burn ledger unavailable.",
      signal: burnRate ? (burnRate.pctSupplyPerDay > 0.3 ? "bull" : burnRate.pctSupplyPerDay > 0.05 ? "neutral" : "bear") : "info",
      group: "flywheel",
      source: "StonkFun burn ledger · 60s",
    },
    {
      key: "buyback",
      label: "Buyback pressure",
      value: `${usd(dailyBuyback)} / day`,
      detail: `${(buybackShare * 100).toFixed(0)}% of fee revenue buys STONK every few minutes, then burns it · ${usd(revenue.revenue.totalBuybackUsd)} lifetime.`,
      signal: dailyBuyback > 10_000 ? "bull" : dailyBuyback > 1_000 ? "neutral" : "bear",
      group: "flywheel",
      source: "StonkFun revenue · 30s",
    },
    {
      key: "buybackvol",
      label: "Buybacks / 24h volume",
      value: buybackVsVolume !== null ? `${buybackVsVolume.toFixed(1)}%` : "—",
      detail: "How much of STONK's daily order flow is the flywheel itself.",
      signal: buybackVsVolume === null ? "info" : buybackVsVolume > 1 ? "bull" : buybackVsVolume > 0.25 ? "neutral" : "bear",
      group: "flywheel",
    },
    {
      key: "revgrowth",
      label: "Revenue growth, 7d",
      value: rev7Delta !== null ? pct(rev7Delta, 0) : "—",
      detail: `${usd(rev7)} in fees this week vs ${usd(revPrev7)} the week before.`,
      signal: rev7Delta === null ? "info" : rev7Delta > 20 ? "bull" : rev7Delta > -10 ? "neutral" : "bear",
      group: "flywheel",
      source: "StonkFun revenue history · 5 min",
    },
    {
      key: "buybackprice",
      label: "Price vs avg buyback price",
      value: buybackMultiple ? `${buybackMultiple.toFixed(1)}×` : "—",
      detail: avgBuybackPrice
        ? `Buybacks averaged $${avgBuybackPrice.toFixed(5)} per STONK vs $${(m.priceUsd ?? 0).toFixed(4)} now.`
        : "",
      signal: buybackMultiple ? (buybackMultiple > 1 ? "bull" : "bear") : "info",
      group: "flywheel",
    },
    {
      key: "quoted",
      label: "STONK-quoted volume, 24h",
      value: `${usd(quotedVolume)}`,
      detail: `Through ${num(quotedTotal)} pools priced in STONK (${quotedGraduated} graduated, ${quotedNew24h} launched today, ${usd(quotedMcap)} combined market cap).`,
      // Total-ever count only rises, so it is not the score; 24h volume through STONK-quoted pools is.
      signal: quotedVolume >= 1_000_000 ? "bull" : quotedVolume >= 100_000 ? "neutral" : "bear",
      group: "demand",
      source: "StonkFun token list · 30s",
    },
    {
      key: "pooldepth",
      label: "Main pool depth",
      value: pool ? usd(pool.tvl) : "—",
      detail: pool && sides
        ? `${num(sides.stonkReserve)} STONK + ${num(sides.quoteReserve)} ${sides.quote.symbol} on Raydium · ${usd(pool.day?.volume ?? 0)} volume 24h.${gmgn?.biggestPool && gmgn.biggestPool.address !== STONK_POOL ? ` ${gmgn.biggestPool.exchange} STONK/${gmgn.biggestPool.quoteSymbol} is deeper at ${usd(gmgn.biggestPool.liquidityUsd)}.` : ""}`
        : "Raydium pool info unavailable.",
      signal: pool ? (pool.tvl > 5_000_000 ? "bull" : pool.tvl > 500_000 ? "neutral" : "bear") : "info",
      group: "demand",
      source: "Raydium · 60s",
    },
    {
      key: "netflow",
      label: "Net flow, main pool, 24h",
      value: flowReady && flow ? `${flow.netStonkIntoPool <= 0 ? "" : "−"}${usd(Math.abs(flow.netStonkUsd))} ${flow.netStonkIntoPool <= 0 ? "net buying" : "net selling"}` : "collecting",
      detail: flowReady && flow
        ? `STONK reserve ${num(flow.stonkReserveStart)} → ${num(flow.stonkReserveEnd)} over ${flowHours.toFixed(0)}h. A falling reserve is net buying.`
        : flow
          ? `Scored after 12h of pool snapshots (${flowHours < 1 ? `${Math.round(flowHours * 60)} min` : `${flowHours.toFixed(0)}h`} so far).`
          : "Scored after 12h of pool snapshots.",
      signal: flowReady && flow ? (flow.netStonkIntoPool < 0 ? "bull" : flow.netStonkIntoPool > 0 ? "bear" : "neutral") : "info",
      group: "demand",
      source: "stonk.fyi pool snapshots · 5 min",
    },
    {
      key: "turnover",
      label: "Turnover, 24h",
      value: turnover !== null ? `${(turnover * 100).toFixed(1)}%` : "—",
      detail: `${usd(m.volume24hUsd ?? 0)} traded against a ${usd(m.marketCapUsd ?? 0)} market cap. Extremes either way are a caution.`,
      signal: turnover === null ? "info" : turnover > 0.02 && turnover < 1 ? "bull" : "neutral",
      group: "demand",
    },
    {
      key: "change24",
      label: "Price change, 24h",
      value: m.priceChange24h !== undefined ? pct(m.priceChange24h, 1) : "—",
      detail: "StonkFun's reported 24h change in USD price. Includes SPYx's own move.",
      signal: m.priceChange24h === undefined ? "info" : m.priceChange24h > 0 ? "bull" : m.priceChange24h > -15 ? "neutral" : "bear",
      group: "demand",
    },
    // ---- Holders & flow (GMGN) ----
    ...(gmgn ? gmgnIndicators(gmgn, gmgnHistory) : []),
    {
      key: "platform",
      label: "Launchpad volume, 24h",
      value: usd(stats.tokens.totalVolume24hUsd),
      detail: `Across ${num(stats.tokens.total)} tokens, ${num(stats.tokens.graduated)} graduated. More volume, more fees, more burns.`,
      signal: stats.tokens.totalVolume24hUsd > 10_000_000 ? "bull" : stats.tokens.totalVolume24hUsd > 1_000_000 ? "neutral" : "bear",
      group: "platform",
      source: "StonkFun stats · 30s",
    },
    {
      key: "launchmult",
      label: "Growth since launch",
      value: launchMultiple ? `${num(launchMultiple)}×` : "—",
      detail: `Launched ${Math.floor(daysLive)} days ago at a ${usd(launchMcap)} market cap; graduated ${token.graduatedAt ? `${Math.round((Date.parse(token.graduatedAt) - Date.parse(token.createdAt)) / 60000)} minutes` : "shortly"} later.`,
      signal: "info",
      group: "valuation",
    },
    {
      key: "ps",
      label: "Market cap / annualized revenue",
      value: psRatio ? `${psRatio.toFixed(1)}×` : "—",
      detail: `7-day run rate annualizes to ${usd(annualizedRun7)} (lifetime pace ${usd(annualizedRevenue)}).`,
      signal: psRatio === null ? "info" : psRatio < 10 ? "bull" : psRatio < 30 ? "neutral" : "bear",
      group: "valuation",
    },
  ];

  // Full days only: launch day and today are partial.
  const revDays = days.slice(1, -1).map((d) => d.dailyRevenue).filter((v) => v > 0);
  const revMin = revDays.length ? Math.min(...revDays) : 0;
  const revMax = revDays.length ? Math.max(...revDays) : 0;
  const watch = [
    {
      label: "USD price rides SPYx",
      detail: "STONK has no USD market of its own: its dollar price is the pool ratio × SPYx's price, so it carries S&P 500 beta, and because SPYx has no live reference outside US market hours the USD figure can drift over weekends and gap at Monday open. StonkFun's own SPYx-priced chart only rises when STONK outruns the index.",
    },
    ...(gmgn?.biggestPool && gmgn.biggestPool.quoteSymbol !== "SPYx"
      ? [{
          label: "Two reference prices",
          detail: `${gmgn.biggestPool.exchange} STONK/${gmgn.biggestPool.quoteSymbol} (${usd(gmgn.biggestPool.liquidityUsd)}) prices STONK without SPYx; the spread vs StonkFun is under the hero price. A persistent gap means one feed is stale.`,
        }]
      : []),
    {
      label: "Revenue volatility",
      detail: `Daily fees have ranged from ${usd(revMin)} to ${usd(revMax)} since launch. Buyback pressure follows with no lag, in both directions.`,
    },
  ];
  void fromPeak;

  return {
    token,
    burns,
    revenue,
    days,
    stats,
    quoted,
    quotedTotal,
    history,
    pool,
    poolSides: sides,
    flow,
    gmgn,
    gmgnHistory,
    projection: {
      price: m.priceUsd ?? 0,
      supply: circulating,
      marketCap: m.marketCapUsd ?? 0,
      dailyRevenue: rev7 / 7,
      buybackShare,
      volume24h: m.volume24hUsd ?? 0,
      quoteDepthUsd: sides?.quoteSideUsd ?? null,
      poolVolume24h: pool?.day?.volume ?? null,
    },
    supply,
    burnRate,
    indicators,
    watch,
    generatedAt: tokenRes.meta.generatedAt,
  };
}

// GMGN-derived indicators: holder base, concentration, buy/sell pressure across every STONK pool,
// smart-money presence. Contract/LP facts are permanent, so they live in the Foundation block, unscored.
function gmgnIndicators(g: GmgnData, hist: Awaited<ReturnType<typeof getGmgnHistory>>): Indicator[] {
  const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
  const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`);
  const num = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));
  const src = "GMGN · 60s";

  const histReady = !!hist && hist.hours >= 12;
  const holderDelta = histReady ? g.holderCount - hist.first.holderCount : null;
  const holderDeltaPct = holderDelta !== null && hist ? (holderDelta / hist.first.holderCount) * 100 : null;

  const buyShare = g.vol24h.buyUsd + g.vol24h.sellUsd ? g.vol24h.buyUsd / (g.vol24h.buyUsd + g.vol24h.sellUsd) : null;
  const top10 = g.top10HolderRate * 100;

  return [
    {
      key: "holders",
      label: "Holders",
      value: num(g.holderCount),
      detail: histReady && holderDelta !== null && holderDeltaPct !== null
        ? `${holderDelta >= 0 ? "+" : ""}${num(holderDelta)} wallets (${pct(holderDeltaPct, 2)}) in ${hist!.hours.toFixed(0)}h · ${num(g.wallets.whale)} whales · ${(g.freshWalletRate * 100).toFixed(0)}% fresh wallets.`
        : `${num(g.wallets.whale)} whales · ${(g.freshWalletRate * 100).toFixed(0)}% fresh wallets. Scored on 24h change after 12h of snapshots (${hist ? `${hist.hours.toFixed(0)}h` : "0h"} so far).`,
      signal: histReady && holderDeltaPct !== null ? (holderDeltaPct > 0.5 ? "bull" : holderDeltaPct >= -0.5 ? "neutral" : "bear") : "info",
      group: "holders",
      source: src,
    },
    {
      key: "top10",
      label: "Top-10 concentration",
      value: `${top10.toFixed(1)}%`,
      detail: "Share of supply in the ten largest wallets, pools included.",
      signal: top10 < 20 ? "bull" : top10 < 35 ? "neutral" : "bear",
      group: "holders",
      source: src,
    },
    {
      key: "buypressure",
      label: "Buy share, 24h, all pools",
      value: buyShare !== null ? `${(buyShare * 100).toFixed(1)}%` : "—",
      detail: `${usd(g.vol24h.buyUsd)} bought vs ${usd(g.vol24h.sellUsd)} sold across every pool STONK trades in.`,
      signal: buyShare === null ? "info" : buyShare > 0.52 ? "bull" : buyShare >= 0.48 ? "neutral" : "bear",
      group: "holders",
      source: src,
    },
    {
      key: "smartmoney",
      label: "Smart-money holders",
      value: `${num(g.wallets.smart)} · ${num(g.wallets.kol)}`,
      detail: `${num(g.wallets.smart)} smart-money and ${num(g.wallets.kol)} KOL wallets, as tagged by GMGN.`,
      signal: g.wallets.smart >= 100 ? "bull" : g.wallets.smart >= 25 ? "neutral" : "bear",
      group: "holders",
      source: src,
    },
  ];
}

// Deduplicated per request: layout (nav ring + ticker) and page both need it.
export const getStonkData = cache(computeStonkData);
