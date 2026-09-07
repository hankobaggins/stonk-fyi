import "server-only";
import type {
  ApiEnvelope,
  PricePoint,
  TokenBurns,
  TokenFees,
  TokenRewards,
  Launch,
  LaunchesResponse,
  Pair,
  Revenue,
  RevenueHistory,
  RewardsResponse,
  Stats,
  Token,
  TokensResponse,
} from "./types";

export const API_BASE = process.env.STONKFUN_API_BASE ?? "https://www.stonkfun.xyz/api/public/v1";
export const SITE_BASE = "https://www.stonkfun.xyz";
export const STONK_MINT = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";

// DATA_SOURCE=fixture serves captured responses from src/fixtures (for local dev
// without network access). Anything else hits the live API.
const USE_FIXTURES = process.env.DATA_SOURCE === "fixture";

async function fixture<T>(name: string): Promise<ApiEnvelope<T>> {
  const mod = await import(`@/fixtures/${name}.json`);
  return (mod.default ?? mod) as ApiEnvelope<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>, revalidate = 30): Promise<ApiEnvelope<T>> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "stonkfun-dashboard/0.1" },
    next: { revalidate },
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText} for ${url.pathname}`);
  return (await res.json()) as ApiEnvelope<T>;
}

// ---------- Platform ----------

export async function getStats() {
  return USE_FIXTURES ? fixture<Stats>("stats") : get<Stats>("/stats", undefined, 30);
}

export async function getRevenue() {
  return USE_FIXTURES ? fixture<Revenue>("revenue") : get<Revenue>("/revenue", undefined, 30);
}

export async function getRevenueHistory() {
  return USE_FIXTURES ? fixture<RevenueHistory>("revenue-history") : get<RevenueHistory>("/revenue/history", undefined, 300);
}

export async function getRewards() {
  return USE_FIXTURES ? fixture<RewardsResponse>("rewards") : get<RewardsResponse>("/rewards", undefined, 120);
}

// ---------- Tokens ----------

export type TokenQuery = {
  q?: string;
  sort?: "marketCap" | "newest" | "volume";
  mode?: string;
  status?: string;
  quoteMint?: string;
  category?: string;
  page?: number;
  pageSize?: number;
};

export async function getTokens(query: TokenQuery = {}) {
  if (USE_FIXTURES) {
    const fx = await fixture<TokensResponse>("tokens");
    let tokens = [...fx.data.tokens];
    if (query.q) {
      const q = query.q.toLowerCase();
      tokens = tokens.filter((t) => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.mint === query.q);
    }
    if (query.mode) tokens = tokens.filter((t) => t.mode === query.mode);
    if (query.status) tokens = tokens.filter((t) => t.status === query.status);
    if (query.category) tokens = tokens.filter((t) => t.quote.category === query.category);
    if (query.quoteMint) tokens = tokens.filter((t) => t.quote.mint === query.quoteMint);
    const key = query.sort === "newest" ? null : query.sort === "volume" ? "volume24hUsd" : "marketCapUsd";
    tokens.sort((a, b) =>
      key ? (b.market?.[key] ?? 0) - (a.market?.[key] ?? 0) : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    const pageSize = query.pageSize ?? 50;
    const page = query.page ?? 1;
    const slice = tokens.slice((page - 1) * pageSize, page * pageSize);
    return {
      data: {
        tokens: slice,
        pagination: { page, pageSize, total: tokens.length, totalPages: Math.max(1, Math.ceil(tokens.length / pageSize)) },
        network: fx.data.network,
      },
      meta: fx.meta,
    } as ApiEnvelope<TokensResponse>;
  }
  return get<TokensResponse>("/tokens", { ...query }, 30);
}

// Live shape is { data: { token, launch, network } }; older/simpler shape put the token at data directly.
// Both are accepted, and the launch record (start/target market cap, creator) is returned alongside.
export type TokenDetail = { token: Token; launch?: Launch | null; network?: string };

function unwrapTokenDetail(data: unknown): TokenDetail | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.token && typeof d.token === "object" && "mint" in (d.token as object)) {
    return { token: d.token as Token, launch: (d.launch as Launch | undefined) ?? null, network: d.network as string | undefined };
  }
  if ("mint" in d && "symbol" in d) return { token: d as unknown as Token, launch: null };
  return null;
}

export async function getToken(mint: string): Promise<ApiEnvelope<TokenDetail> | null> {
  if (USE_FIXTURES) {
    const fx = await fixture<TokensResponse>("tokens");
    const t = fx.data.tokens.find((x) => x.mint === mint);
    if (!t) return null;
    const lx = await fixture<LaunchesResponse>("launches");
    const launch = lx.data.launches.find((l) => l.mint === mint) ?? null;
    return { data: { token: t, launch, network: fx.data.network }, meta: fx.meta };
  }
  try {
    const res = await get<unknown>(`/tokens/${mint}`, undefined, 30);
    const detail = unwrapTokenDetail(res.data);
    if (!detail) throw new ApiError(502, `Unexpected /tokens/${mint} response shape: keys=${Object.keys((res.data as object) ?? {}).join(",")}`);
    return { data: detail, meta: res.meta };
  } catch (e) {
    // 404 = unknown mint; 400 = StonkFun rejects the address (bots crawl /tokens/<junk>). Both are "not found" for the page.
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

// Sub-resources are optional. Any 4xx means "not available for this token" (e.g. /backing returns
// 400 "Backing is only tracked for Pump launches" for almost every mint) and yields null; only
// 5xx and network failures throw, and the token page isolates those per section.
async function optional<T>(path: string, revalidate = 60, fixtureName?: string): Promise<T | null> {
  if (USE_FIXTURES) return fixtureName ? (await fixture<T>(fixtureName)).data : null;
  try {
    return (await get<T>(path, undefined, revalidate)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) return null;
    throw e;
  }
}

export async function getTokenBurns(mint: string, revalidate = 60): Promise<TokenBurns | null> {
  if (USE_FIXTURES) {
    if (mint !== STONK_MINT) return null;
    return (await fixture<TokenBurns>("stonk-burns")).data;
  }
  return optional<TokenBurns>(`/tokens/${mint}/burns`, revalidate);
}
export const getTokenRewards = (mint: string) => optional<TokenRewards>(`/tokens/${mint}/rewards`, 60, mint === STONK_MINT ? "token-rewards-standard" : "token-rewards-reward");
export const getTokenFees = (mint: string) => optional<TokenFees>(`/tokens/${mint}/fees`, 60, mint === STONK_MINT ? "token-fees-standard" : "token-fees-reward");
// Only Pump launches have backing; everything else 400s → null. Shape not verified, rendered as JSON.
export const getTokenBacking = (mint: string) => optional<Record<string, unknown>>(`/tokens/${mint}/backing`);

// ---------- Launches ----------

export async function getLaunches(query: { creator?: string; mode?: string; since?: string; page?: number; pageSize?: number } = {}) {
  return USE_FIXTURES ? fixture<LaunchesResponse>("launches") : get<LaunchesResponse>("/launches", { ...query }, 30);
}

// ---------- Pairs ----------

export async function getPairs(): Promise<Pair[]> {
  if (USE_FIXTURES) {
    // Derive a pair list from the token fixture's quote field.
    const fx = await fixture<TokensResponse>("tokens");
    const seen = new Map<string, Pair>();
    for (const t of fx.data.tokens) if (!seen.has(t.quote.mint)) seen.set(t.quote.mint, { ...t.quote, launchable: true, launchLabReady: true });
    return [...seen.values()];
  }
  const res = await get<{ pairs: Pair[] } | Pair[]>("/pairs", undefined, 300);
  return Array.isArray(res.data) ? res.data : res.data.pairs ?? [];
}

// ---------- Aggregations ----------

// Fetch the top N tokens by volume across pages (N/100 requests, well under the 300/min limit).
export async function getTopTokens(limit = 300, sort: "marketCap" | "volume" = "volume"): Promise<Token[]> {
  const pageSize = 100;
  const pages = Math.ceil(limit / pageSize);
  const out: Token[] = [];
  for (let page = 1; page <= pages; page++) {
    const res = await getTokens({ sort, page, pageSize });
    out.push(...res.data.tokens);
    if (page >= res.data.pagination.totalPages) break;
  }
  return out.slice(0, limit);
}

export function resolveImage(url?: string): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/") ? SITE_BASE + url : url;
}

// ---------- External: CoinGecko price history (best-effort) ----------
// Public endpoint, no key needed at low volume. Returns null on any failure so the
// page degrades to "history pending" rather than erroring.
export async function getStonkPriceHistory(days = 90): Promise<PricePoint[] | null> {
  if (USE_FIXTURES) return null;
  const id = process.env.COINGECKO_STONK_ID ?? "stonk-3";
  const key = process.env.COINGECKO_API_KEY;
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url, {
      headers: { accept: "application/json", ...(key ? { "x-cg-demo-api-key": key } : {}) },
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { prices?: [number, number][]; market_caps?: [number, number][]; total_volumes?: [number, number][] };
    if (!j.prices?.length) return null;
    const caps = new Map((j.market_caps ?? []).map(([t, v]) => [t, v]));
    const vols = new Map((j.total_volumes ?? []).map(([t, v]) => [t, v]));
    return j.prices.map(([ts, price]) => ({ ts, price, marketCap: caps.get(ts), volume: vols.get(ts) }));
  } catch {
    return null;
  }
}
