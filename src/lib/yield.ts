import "server-only";
import { getRewards, getToken, getTokens, STONK_MINT } from "./api";
import { getDb, getRewardWindows, type RewardWindow } from "./db";
import { getUsdPrices } from "./jupiter";
import type { RewardLaunch, Token } from "./types";

// Realized holder-fee APR for reward-mode coins.
//
//   APR(window) = (payout tokens over the window × quote USD price now) ÷ market cap now × (8760 ÷ window hours)
//
// Payout tokens come from this site's own reward_snapshots (lifetime distributed tokens per coin,
// every 5 min), so the figure is what holders were actually paid — not trading volume × a fee rate.
// Market cap is the denominator because it is the one figure both the reader and this site can
// verify; a holder's own yield is higher to the extent that ineligible balances (pools, program
// accounts) are excluded from payouts, and lower by whatever the coin's price does.
//
// Scope: the worker snapshots only the YIELD_TRACKED largest reward coins by market cap (the page
// shows the top YIELD_ROWS of the top 100, so 200 is a rank-churn buffer), and the window lookups are
// scoped to those mints. Snapshotting every coin that ever paid (0005's first design) was 5,300 rows
// a tick and made the table unreadable inside the API timeout — see migration 0006.

export const YIELD_MIN_AGE_HOURS = 72;
export const YIELD_ROWS = 10;
export const YIELD_TRACKED = 200;
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
  status: "ok" | "collecting" | "no-db" | "db-error";
  rows: YieldRow[];
  candidates: number; // reward coins old enough, ranked by market cap, before the payout filter
  historyHours: number; // longest span any coin's readings cover
  generatedAt: string;
};

export type RewardCoin = { token: Token; launch: RewardLaunch };

// The reward coins worth snapshotting / showing: the `n` largest by market cap that the rewards
// ledger knows about, market cap descending. Shared by the worker (what to record) and the page
// (what to read) so the two can never disagree about which coins are tracked.
export async function getRewardCoinsByMcap(n = YIELD_TRACKED): Promise<RewardCoin[]> {
  const pageSize = 100;
  const pages = Math.ceil(n / pageSize);
  const [rewards, ...tokenPages] = await Promise.all([
    getRewards(),
    ...Array.from({ length: pages }, (_, i) => getTokens({ mode: "reward", sort: "marketCap", page: i + 1, pageSize })),
  ]);
  const launches = new Map(rewards.data.launches.map((l) => [l.mint, l]));
  const seen = new Set<string>();
  const out: RewardCoin[] = [];
  for (const p of tokenPages) {
    for (const t of p.data.tokens) {
      const launch = launches.get(t.mint);
      if (!launch || t.mode !== "reward" || seen.has(t.mint) || !((t.market?.marketCapUsd ?? 0) > 0)) continue;
      seen.add(t.mint);
      out.push({ token: t, launch });
    }
  }
  out.sort((a, b) => (b.token.market?.marketCapUsd ?? 0) - (a.token.market?.marketCapUsd ?? 0));
  return out.slice(0, n);
}

function cell(w: RewardWindow | undefined, winHours: number, price: number | null, mcap: number): AprCell {
  if (!w || price === null || !(mcap > 0)) return null;
  if (w.hours < winHours * MIN_COVERAGE) return null;
  const tokens = Math.max(0, w.toTokens - w.fromTokens);
  const usd = tokens * price;
  return { apr: (usd / mcap) * (8760 / w.hours) * 100, usd, tokens, hours: w.hours, from: w.from, to: w.to };
}

// Quote-asset USD prices for a set of quote mints: Jupiter, with STONK at StonkFun's own price.
async function quotePrices(quoteMints: string[]): Promise<Record<string, number>> {
  const prices = await getUsdPrices(quoteMints);
  if (quoteMints.includes(STONK_MINT)) {
    const s = await getToken(STONK_MINT).catch(() => null);
    if (s?.data.token.market?.priceUsd) prices[STONK_MINT] = s.data.token.market.priceUsd;
  }
  return prices;
}

// APR for an arbitrary list of tokens (the /tokens page: whatever StonkFun returned for the current
// search/filter/page). Only reward-mode coins can have one, and only the YIELD_TRACKED largest by market
// cap are snapshotted, so each cell also says why it is empty: `standard` (pays holders nothing),
// `untracked` (reward coin outside the tracked set — no readings), `collecting` (readings cover under
// 80% of the window yet), `unpriced` (no Jupiter price for the quote asset).
export type AprReason = "standard" | "untracked" | "collecting" | "unpriced" | "no-db" | "db-error";
export type TokenApr = { d1: AprCell; d3: AprCell; why: AprReason | null };
export type AprLookup = { status: YieldTable["status"]; byMint: Record<string, TokenApr>; generatedAt: string };

export async function getAprForTokens(tokens: Token[]): Promise<AprLookup> {
  const generatedAt = new Date().toISOString();
  const db = getDb();
  const byMint: Record<string, TokenApr> = {};
  const reward = tokens.filter((t) => t.mode === "reward");
  for (const t of tokens) if (t.mode !== "reward") byMint[t.mint] = { d1: null, d3: null, why: "standard" };
  if (!db) {
    for (const t of reward) byMint[t.mint] = { d1: null, d3: null, why: "no-db" };
    return { status: "no-db", byMint, generatedAt };
  }
  if (!reward.length) return { status: "ok", byMint, generatedAt };
  const mints = reward.map((t) => t.mint);
  const [w24, w72, prices] = await Promise.all([getRewardWindows(24, mints), getRewardWindows(72, mints), quotePrices([...new Set(reward.map((t) => t.quote.mint))])]);
  if (w24 === null || w72 === null) {
    for (const t of reward) byMint[t.mint] = { d1: null, d3: null, why: "db-error" };
    return { status: "db-error", byMint, generatedAt };
  }
  for (const t of reward) {
    const price = prices[t.quote.mint] ?? null;
    const mcap = t.market?.marketCapUsd ?? 0;
    const a = w24.get(t.mint);
    const b = w72.get(t.mint);
    const d1 = cell(a, 24, price, mcap);
    const d3 = cell(b, 72, price, mcap);
    const why: AprReason | null = d1 || d3 ? null : !a && !b ? "untracked" : price === null ? "unpriced" : "collecting";
    byMint[t.mint] = { d1, d3, why };
  }
  return { status: "ok", byMint, generatedAt };
}

// The /tokens "Yield" sort: every tracked reward coin (≥72h old, paid inside the last 3 days), ranked by
// 3d APR, then 24h APR where the 3d window is not ready. Computed here, not by StonkFun, so it covers only
// the tracked set; the page applies its own search/filters and paging on top.
export type YieldRanking = { status: YieldTable["status"]; tokens: Token[]; apr: AprLookup; historyHours: number; candidates: number };

export async function getYieldRanking(): Promise<YieldRanking> {
  const cutoff = Date.now() - YIELD_MIN_AGE_HOURS * 3.6e6;
  const coins = (await getRewardCoinsByMcap(YIELD_TRACKED)).filter((c) => Date.parse(c.token.createdAt) <= cutoff);
  const apr = await getAprForTokens(coins.map((c) => c.token));
  const score = (m: string) => apr.byMint[m]?.d3?.apr ?? (apr.byMint[m]?.d1 ? apr.byMint[m].d1!.apr : -1);
  const paid = coins.map((c) => c.token).filter((t) => apr.byMint[t.mint]?.d3?.tokens || apr.byMint[t.mint]?.d1?.tokens);
  paid.sort((x, y) => score(y.mint) - score(x.mint));
  let historyHours = 0;
  for (const t of coins) historyHours = Math.max(historyHours, apr.byMint[t.token.mint]?.d3?.hours ?? apr.byMint[t.token.mint]?.d1?.hours ?? 0);
  const status = apr.status !== "ok" ? apr.status : paid.length ? "ok" : "collecting";
  return { status, tokens: paid, apr, historyHours, candidates: coins.length };
}

export async function getYieldTable(): Promise<YieldTable> {
  const generatedAt = new Date().toISOString();
  const db = getDb();
  const cutoff = Date.now() - YIELD_MIN_AGE_HOURS * 3.6e6;
  const coins = (await getRewardCoinsByMcap(100)).filter((c) => Date.parse(c.token.createdAt) <= cutoff);
  const mints = coins.map((c) => c.token.mint);

  const [w24, w72] = await Promise.all([db ? getRewardWindows(24, mints) : null, db ? getRewardWindows(72, mints) : null]);
  // The RPC failing (timeout, missing migration) must not masquerade as "no history yet".
  const dbError = !!db && (w24 === null || w72 === null);

  const prices = await quotePrices([...new Set(coins.map((c) => c.launch.quote.mint))]);

  let historyHours = 0;
  for (const w of w72?.values() ?? []) historyHours = Math.max(historyHours, w.hours);

  const rows: YieldRow[] = [];
  for (const { token: t, launch: l } of coins) {
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
    status: !db ? "no-db" : dbError ? "db-error" : rows.length ? "ok" : "collecting",
    rows,
    candidates: coins.length,
    historyHours,
    generatedAt,
  };
}
