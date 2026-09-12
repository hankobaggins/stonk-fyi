import "server-only";

// HolderScan API client (https://docs.holderscan.com/api/intro). Optional: `HOLDERSCAN_API_KEY` unset →
// every call reports an error and the worker steps record nothing. Base https://api.holderscan.com/v0,
// header `x-api-key`. Beta API with a "supported tokens" list — a mint HolderScan does not track answers
// 404 and is reported as "no reading", never as zero.
//
// Plans (docs.holderscan.com/api/plans, 2026-09-12): Standard (bundled with HolderScan Premium) 200K request
// units a month, 300 requests a minute; Advanced $149/mo, 15M units, 1000/min. `HOLDERSCAN_PLAN=advanced`
// switches the site's cadences (CLAUDE.md §6h): STONK profile every tick instead of every 6 h, universe and
// stock-quoted counts hourly instead of daily / GMGN. Route costs (units): holders 10, deltas 20, breakdowns 50,
// stats 20, stats/pnl 20, stats/wallet-categories 20, stats/supply-breakdown 20, token details 10.

const BASE = process.env.HOLDERSCAN_API_BASE ?? "https://api.holderscan.com/v0";
const KEY = () => process.env.HOLDERSCAN_API_KEY;
export const HOLDERSCAN_ADVANCED = (process.env.HOLDERSCAN_PLAN ?? "standard").toLowerCase() === "advanced";
// 300/min → one every 200 ms on Standard (250 leaves headroom); 1000/min → 60 ms on Advanced (100 leaves headroom).
export const HOLDERSCAN_GAP_MS = Math.max(0, Number(process.env.HOLDERSCAN_GAP_MS ?? (HOLDERSCAN_ADVANCED ? 100 : 250)));

export const holderscanEnabled = () => !!KEY();

// Last non-OK answer, for /api/health.
export let lastHolderscanError: string | null = null;

let lastCallAt = 0;
async function get<T>(path: string): Promise<{ status: number; body: T | null; text: string }> {
  if (!KEY()) throw new Error("HOLDERSCAN_API_KEY not set");
  const wait = lastCallAt + HOLDERSCAN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers: { "x-api-key": KEY()!, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 4_000 * (attempt + 1)));
      continue;
    }
    const text = await res.text().catch(() => "");
    let body: T | null = null;
    try { body = text ? (JSON.parse(text) as T) : null; } catch { body = null; }
    if (res.status !== 200 && res.status !== 404) lastHolderscanError = `${path}: HTTP ${res.status} ${text.slice(0, 120)}`;
    return { status: res.status, body, text };
  }
}

type Read<T> = { data: T | null; error: string | null };

// Every route below answers the same three ways: 404 = not tracked, other non-200 = the HTTP error,
// 200 with an unexpected body = "unexpected shape". `parse` returns null when the body is not what we expect.
async function read<T>(path: string, parse: (body: Record<string, unknown>) => T | null): Promise<Read<T>> {
  try {
    const r = await get<Record<string, unknown>>(path);
    if (r.status === 404) return { data: null, error: "not tracked by HolderScan" };
    if (r.status !== 200) return { data: null, error: `HTTP ${r.status} ${String(r.body?.message ?? r.body?.error ?? r.text).slice(0, 120)}` };
    const data = r.body ? parse(r.body) : null;
    if (data === null) return { data: null, error: `unexpected shape: ${r.text.slice(0, 120)}` };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => { const n = num(v); return n === null ? null : Math.round(n); };
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// ---------- holder count (10 units) ----------

export type HolderCountRead = { holders: number | null; error: string | null };

// Current holder count: `GET /sol/tokens/{mint}/holders?limit=1` → `holder_count` (the list itself is not used).
export async function getHolderscanHolderCount(mint: string): Promise<HolderCountRead> {
  const r = await read(`/sol/tokens/${mint}/holders?limit=1`, (b) => int(b.holder_count));
  return { holders: r.data, error: r.error };
}

// ---------- top holders (10 units a page, top 1000 at most) ----------

export type TopHolder = { address: string; amount: number; rank: number };
export type TopHolders = { holderCount: number; holders: TopHolder[] };

// `GET /sol/tokens/{mint}/holders?limit=N` — `amount` is in whole tokens (UI units) per the docs' example;
// the caller sanity-checks against the supply in case a mint answers in raw base units.
export async function getHolderscanTopHolders(mint: string, limit = 100): Promise<Read<TopHolders>> {
  return read(`/sol/tokens/${mint}/holders?limit=${Math.min(100, Math.max(1, limit))}`, (b) => {
    const holderCount = int(b.holder_count);
    const list = Array.isArray(b.holders) ? b.holders : null;
    if (holderCount === null || !list) return null;
    const holders: TopHolder[] = [];
    for (const h of list) {
      const o = obj(h);
      const amount = num(o?.amount);
      if (!o || typeof o.address !== "string" || amount === null) continue;
      holders.push({ address: o.address, amount, rank: int(o.rank) ?? holders.length + 1 });
    }
    return { holderCount, holders };
  });
}

// ---------- deltas (20 units) ----------

export type HolderDeltas = { h1: number | null; h4: number | null; h12: number | null; d1: number | null; d3: number | null; d7: number | null; d14: number | null; d30: number | null };

// HolderScan's own change in holder count: `GET /sol/tokens/{mint}/holders/deltas` →
// `{ "1hour", "2hours", "4hours", "12hours", "1day", "3days", "7days", "14days", "30days" }` (the short windows
// were added to the route after this site first used it; older answers carry only 7/14/30 days).
export async function getHolderscanDeltas(mint: string): Promise<{ deltas: HolderDeltas | null; error: string | null }> {
  const r = await read(`/sol/tokens/${mint}/holders/deltas`, (b) => {
    const d: HolderDeltas = { h1: int(b["1hour"]), h4: int(b["4hours"]), h12: int(b["12hours"]), d1: int(b["1day"]), d3: int(b["3days"]), d7: int(b["7days"]), d14: int(b["14days"]), d30: int(b["30days"]) };
    return d.d7 === null && d.d14 === null && d.d30 === null && d.d1 === null ? null : d;
  });
  return { deltas: r.data, error: r.error };
}

// ---------- breakdowns by holding value (50 units) ----------

export type HolderBreakdowns = {
  total: number;
  over10: number; over100: number; over1k: number; over10k: number; over100k: number; over1m: number;
  shrimp: number; crab: number; fish: number; dolphin: number; whale: number;
};

// `GET /sol/tokens/{mint}/holders/breakdowns`: holders with more than $10 / $100 / … / $1M of the token, and
// HolderScan's five size tiers (shrimp → whale). USD tiers are HolderScan's valuation at read time.
export async function getHolderscanBreakdowns(mint: string): Promise<Read<HolderBreakdowns>> {
  return read(`/sol/tokens/${mint}/holders/breakdowns`, (b) => {
    const c = obj(b.categories) ?? {};
    const total = int(b.total_holders);
    const over1k = int(b.holders_over_1000_usd);
    if (total === null || over1k === null) return null;
    return {
      total,
      over10: int(b.holders_over_10_usd) ?? 0,
      over100: int(b.holders_over_100_usd) ?? 0,
      over1k,
      over10k: int(b.holders_over_10000_usd) ?? 0,
      over100k: int(b.holders_over_100k_usd) ?? 0,
      over1m: int(b.holders_over_1m_usd) ?? 0,
      shrimp: int(c.shrimp) ?? 0,
      crab: int(c.crab) ?? 0,
      fish: int(c.fish) ?? 0,
      dolphin: int(c.dolphin) ?? 0,
      whale: int(c.whale) ?? 0,
    };
  });
}

// ---------- token statistics (20 units each) ----------

export type HolderStats = { hhi: number | null; gini: number | null; medianPosition: number | null; avgTimeHeldSec: number | null; retentionRate: number | null };

// `GET /sol/tokens/{mint}/stats`: concentration (HHI, Gini), the median holder's position in whole tokens,
// average hold time in seconds and retention rate (the last two are null for tokens HolderScan has not profiled).
export async function getHolderscanStats(mint: string): Promise<Read<HolderStats>> {
  return read(`/sol/tokens/${mint}/stats`, (b) => {
    const s: HolderStats = { hhi: num(b.hhi), gini: num(b.gini), medianPosition: num(b.median_holder_position), avgTimeHeldSec: num(b.avg_time_held), retentionRate: num(b.retention_rate) };
    return s.hhi === null && s.gini === null && s.medianPosition === null ? null : s;
  });
}

export type HolderPnl = { breakEvenPrice: number | null; realizedPnlUsd: number | null; unrealizedPnlUsd: number | null };

// `GET /sol/tokens/{mint}/stats/pnl`: aggregate break-even price and realized / unrealized PnL in USD.
export async function getHolderscanPnl(mint: string): Promise<Read<HolderPnl>> {
  return read(`/sol/tokens/${mint}/stats/pnl`, (b) => {
    const p: HolderPnl = { breakEvenPrice: num(b.break_even_price), realizedPnlUsd: num(b.realized_pnl_total), unrealizedPnlUsd: num(b.unrealized_pnl_total) };
    return p.breakEvenPrice === null && p.realizedPnlUsd === null && p.unrealizedPnlUsd === null ? null : p;
  });
}

export type WalletCategories = { diamond: number; gold: number; silver: number; bronze: number; wood: number; newHolders: number };

// `GET /sol/tokens/{mint}/stats/wallet-categories`: the top 1000 holders by HolderScan's hold-time class.
export async function getHolderscanWalletCategories(mint: string): Promise<Read<WalletCategories>> {
  return read(`/sol/tokens/${mint}/stats/wallet-categories`, (b) => {
    const d = int(b.diamond);
    if (d === null) return null;
    return { diamond: d, gold: int(b.gold) ?? 0, silver: int(b.silver) ?? 0, bronze: int(b.bronze) ?? 0, wood: int(b.wood) ?? 0, newHolders: int(b.new_holders) ?? 0 };
  });
}

export type SupplyBreakdown = { diamond: number; gold: number; silver: number; bronze: number; wood: number };

// `GET /sol/tokens/{mint}/stats/supply-breakdown`: the top 1000 wallets' holdings (whole tokens) by hold-time
// class, FIFO. Σ = the supply those wallets hold, not the total supply.
export async function getHolderscanSupplyBreakdown(mint: string): Promise<Read<SupplyBreakdown>> {
  return read(`/sol/tokens/${mint}/stats/supply-breakdown`, (b) => {
    const d = num(b.diamond);
    if (d === null) return null;
    return { diamond: d, gold: num(b.gold) ?? 0, silver: num(b.silver) ?? 0, bronze: num(b.bronze) ?? 0, wood: num(b.wood) ?? 0 };
  });
}

export type TokenDetails = { decimals: number; supply: number };

// `GET /sol/tokens/{mint}`: decimals and raw supply (a decimal string), used to sanity-check amounts.
export async function getHolderscanToken(mint: string): Promise<Read<TokenDetails>> {
  return read(`/sol/tokens/${mint}`, (b) => {
    const decimals = int(b.decimals);
    const supply = typeof b.supply === "string" ? Number(b.supply) : num(b.supply);
    if (decimals === null || supply === null || !Number.isFinite(supply)) return null;
    return { decimals, supply: supply / 10 ** decimals };
  });
}
