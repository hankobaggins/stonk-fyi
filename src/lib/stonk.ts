import { cache } from "react";
import "server-only";
import { getRevenue, getRevenueHistory, getStats, getStonkPriceHistory, getToken, getTokenBurns, getTokens, STONK_MINT } from "./api";
import { getPoolInfo, poolSides } from "./raydium";
import { getPoolFlow } from "./db";
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
  group: "supply" | "flywheel" | "demand" | "platform" | "valuation";
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
  const flow = await getPoolFlow(STONK_POOL, 24, m.priceUsd);
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
      key: "burned",
      label: "Supply permanently burned",
      value: `${supply.burnedPct.toFixed(2)}%`,
      detail: `${num(burned)} of 1B STONK destroyed across ${num(burns?.totals.burnCount ?? 0)} on-chain burns. Mint & freeze authority are null — supply can only fall.`,
      signal: supply.burnedPct > 5 ? "bull" : supply.burnedPct > 1 ? "neutral" : "info",
      group: "supply",
      source: "/tokens/{mint}/burns",
    },
    {
      key: "burnrate",
      label: "Current burn velocity",
      value: burnRate ? `${burnRate.pctSupplyPerDay.toFixed(2)}% / day` : "—",
      detail: burnRate
        ? `${num(burnRate.tokensPerHour)} STONK/hour over the last ${burnRate.sample} burns (${burnRate.windowHours.toFixed(1)}h window) ≈ ${burnRate.annualizedPct.toFixed(0)}% of supply annualized at this pace.`
        : "Burn ledger unavailable.",
      signal: burnRate ? (burnRate.pctSupplyPerDay > 0.3 ? "bull" : burnRate.pctSupplyPerDay > 0.05 ? "neutral" : "bear") : "info",
      group: "supply",
      source: "/tokens/{mint}/burns",
    },
    {
      key: "buyback",
      label: "Automated buyback pressure",
      value: `${usd(dailyBuyback)} / day`,
      detail: `${(buybackShare * 100).toFixed(0)}% of platform fee revenue is swept into STONK buys every few minutes, then burned. ${num(revenue.revenue.buybackCount)} buybacks, ${usd(revenue.revenue.totalBuybackUsd)} lifetime.`,
      signal: dailyBuyback > 10_000 ? "bull" : dailyBuyback > 1_000 ? "neutral" : "bear",
      group: "flywheel",
      source: "/revenue, /revenue/history",
    },
    {
      key: "buybackvol",
      label: "Buybacks as share of daily volume",
      value: buybackVsVolume !== null ? `${buybackVsVolume.toFixed(1)}%` : "—",
      detail: "Programmatic buy-side flow relative to STONK's 24h trading volume. Higher = the flywheel is a larger share of the order flow.",
      signal: buybackVsVolume === null ? "info" : buybackVsVolume > 1 ? "bull" : buybackVsVolume > 0.25 ? "neutral" : "bear",
      group: "flywheel",
    },
    {
      key: "revgrowth",
      label: "Platform revenue growth (7d vs prior 7d)",
      value: rev7Delta !== null ? pct(rev7Delta, 0) : "—",
      detail: `${usd(rev7)} in fees over the last 7 days vs ${usd(revPrev7)} the week before. Revenue is the input to the buyback engine.`,
      signal: rev7Delta === null ? "info" : rev7Delta > 20 ? "bull" : rev7Delta > -10 ? "neutral" : "bear",
      group: "flywheel",
      source: "/revenue/history",
    },
    {
      key: "buybackprice",
      label: "Price vs average buyback price",
      value: buybackMultiple ? `${buybackMultiple.toFixed(1)}×` : "—",
      detail: avgBuybackPrice
        ? `Lifetime buybacks averaged $${avgBuybackPrice.toFixed(5)} per STONK; current price is $${(m.priceUsd ?? 0).toFixed(4)}. Every burned token was removed below today's price.`
        : "",
      signal: buybackMultiple ? (buybackMultiple > 1 ? "bull" : "bear") : "info",
      group: "flywheel",
    },
    {
      key: "quoted",
      label: "Tokens priced in STONK",
      value: `${num(quotedTotal)}`,
      detail: `${quotedGraduated} graduated, ${quotedNew24h} launched in the last 24h. ${usd(quotedVolume)} 24h volume and ${usd(quotedMcap)} market cap denominated in STONK — demand for STONK as a base asset, not just a trade.`,
      signal: quotedTotal >= 50 ? "bull" : quotedTotal >= 10 ? "neutral" : "info",
      group: "demand",
      source: "/tokens?quoteMint=STONK",
    },
    {
      key: "pooldepth",
      label: "Main pool depth (STONK/SPYx)",
      value: pool ? usd(pool.tvl) : "—",
      detail: pool && sides
        ? `${num(sides.stonkReserve)} STONK + ${num(sides.quoteReserve)} ${sides.quote.symbol} in the Raydium ${pool.type.toLowerCase()} pool · ${(pool.feeRate * 100).toFixed(0)}% fee · ${usd(pool.day?.volume ?? 0)} pool volume 24h. Thin depth means the buyback moves price more, and so does everyone else.`
        : "Raydium pool info unavailable.",
      signal: pool ? (pool.tvl > 5_000_000 ? "bull" : pool.tvl > 500_000 ? "neutral" : "bear") : "info",
      group: "demand",
      source: "api-v3.raydium.io",
    },
    {
      key: "netflow",
      label: "Net flow through main pool (24h)",
      value: flowReady && flow ? `${flow.netStonkIntoPool <= 0 ? "" : "−"}${usd(Math.abs(flow.netStonkUsd))} ${flow.netStonkIntoPool <= 0 ? "net buying" : "net selling"}` : "collecting",
      detail: flowReady && flow
        ? `Pool's STONK reserve moved from ${num(flow.stonkReserveStart)} to ${num(flow.stonkReserveEnd)} over ${flowHours.toFixed(0)}h (${flow.samples} snapshots). Reserve falling = STONK leaving the pool = net buying.`
        : flow
          ? `${flowHours < 1 ? `${Math.round(flowHours * 60)} minutes` : `${flowHours.toFixed(0)}h`} of pool snapshots so far (${flow.samples}); scored once 12h of readings exist.`
          : "Needs the snapshot worker running against Supabase; the first reading appears after ~12h of pool snapshots.",
      signal: flowReady && flow ? (flow.netStonkIntoPool < 0 ? "bull" : flow.netStonkIntoPool > 0 ? "bear" : "neutral") : "info",
      group: "demand",
      source: "pool_snapshots",
    },
    {
      key: "turnover",
      label: "24h volume / market cap",
      value: turnover !== null ? `${(turnover * 100).toFixed(1)}%` : "—",
      detail: `${usd(m.volume24hUsd ?? 0)} traded against a ${usd(m.marketCapUsd ?? 0)} market cap. Healthy liquidity for a 6-week-old token; extreme values in either direction are a caution.`,
      signal: turnover === null ? "info" : turnover > 0.02 && turnover < 1 ? "bull" : "neutral",
      group: "demand",
    },
    {
      key: "change24",
      label: "24h price change",
      value: m.priceChange24h !== undefined ? pct(m.priceChange24h, 1) : "—",
      detail: `Peak market cap ${usd(m.peakMarketCapUsd ?? 0)}; currently ${fromPeak !== null ? pct(fromPeak, 1) : "—"} from peak.`,
      signal: m.priceChange24h === undefined ? "info" : m.priceChange24h > 0 ? "bull" : m.priceChange24h > -15 ? "neutral" : "bear",
      group: "demand",
    },
    {
      key: "platform",
      label: "Platform scale",
      value: `${num(stats.tokens.total)} tokens`,
      detail: `${num(stats.tokens.graduated)} graduated · ${usd(stats.tokens.totalMarketCapUsd)} total market cap · ${usd(stats.tokens.totalVolume24hUsd)} 24h volume across the launchpad. More activity → more fees → more burns.`,
      signal: stats.tokens.totalVolume24hUsd > 10_000_000 ? "bull" : stats.tokens.totalVolume24hUsd > 1_000_000 ? "neutral" : "bear",
      group: "platform",
      source: "/stats",
    },
    {
      key: "launchmult",
      label: "Growth since launch",
      value: launchMultiple ? `${num(launchMultiple)}×` : "—",
      detail: `Launched ${Math.floor(daysLive)} days ago at a ${usd(launchMcap)} market cap on a STONK/SPYx pool; graduated ${token.graduatedAt ? `${Math.round((Date.parse(token.graduatedAt) - Date.parse(token.createdAt)) / 60000)} minutes` : "shortly"} later.`,
      signal: "info",
      group: "valuation",
    },
    {
      key: "ps",
      label: "Market cap / annualized revenue",
      value: psRatio ? `${psRatio.toFixed(1)}×` : "—",
      detail: `7-day run-rate revenue annualizes to ${usd(annualizedRun7)} (lifetime pace: ${usd(annualizedRevenue)}). A revenue-backed token, not a pure meme — this multiple is the valuation anchor.`,
      signal: psRatio === null ? "info" : psRatio < 10 ? "bull" : psRatio < 30 ? "neutral" : "bear",
      group: "valuation",
    },
  ];

  const watch = [
    {
      label: "Index exposure via the quote asset",
      detail: "STONK has no USD market of its own: its dollar price is the pool ratio × SPYx's dollar price. So STONK's USD price moves with the S&P 500 on top of anything STONK does (long index beta), while StonkFun's own chart, priced in SPYx, only rises when STONK outruns the index.",
    },
    {
      label: "Weekend and off-hours pricing",
      detail: "SPYx tracks an ETF that only trades during US market hours, but the token trades 24/7 on thin liquidity and a stale reference price. STONK's USD figure inherits that: it can drift over weekends and gap at the Monday open with no STONK trade involved.",
    },
    {
      label: "Revenue volatility",
      detail: "Daily fees have ranged from under $20K to over $180K. Buyback pressure follows revenue with no lag, so a quiet week on the launchpad shrinks the burn immediately.",
    },
    {
      label: fromPeak !== null && fromPeak < -20 ? "Distance from peak" : "Peak proximity",
      detail: fromPeak !== null ? `Market cap is ${pct(fromPeak, 1)} from its all-time peak of ${usd(m.peakMarketCapUsd ?? 0)}.` : "",
    },
    {
      label: "Data provenance",
      detail: "USD values are StonkFun's own pricing. Burn amounts and transaction signatures are on-chain and verifiable; dollar figures are not.",
    },
  ];

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

// Deduplicated per request: layout (nav ring + ticker) and page both need it.
export const getStonkData = cache(computeStonkData);
