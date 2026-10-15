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
export const USE_FIXTURES = process.env.DATA_SOURCE === "fixture";

async function fixture<T>(name: string): Promise<ApiEnvelope<T>> {
  const mod = await import(`@/fixtures/${name}.json`);
  return (mod.default ?? mod) as ApiEnvelope<T>;
}

// Fixture mode: the Community Mode capture (src/fixtures/community.json, §6p) joins the token fixture, so /tokens,
// token pages and quote-asset pages show community coins offline.
async function communityFixtureTokens(): Promise<Token[]> {
  const mod = await import("@/fixtures/community.json");
  return ((mod.default ?? mod) as unknown as { tokens: Token[] }).tokens;
}

// No upstream may hold a render open indefinitely (2026-09-16): a page that waits on a hung
// provider is a page nobody sees. Past this the fetch rejects and the caller's fallback applies.
export const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 10_000;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// `fresh` bypasses Next's data cache (cache: "no-store") — used to re-read a record the caller has
// judged stale (lib/stale-reading.ts) instead of serving the bad entry for the rest of its window.
async function get<T>(path: string, params?: Record<string, string | number | undefined>, revalidate = 30, fresh = false): Promise<ApiEnvelope<T>> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "stonkfun-dashboard/0.1" },
    ...(fresh ? { cache: "no-store" as const } : { next: { revalidate } }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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

// /rewards is paged since ~2026-10-14: StonkFun now answers 100 launches a page (sorted by raw amount distributed)
// with `launchesPagination.total` null — "read pages until one has fewer than pageSize rows". The site read only page 1,
// so every rewards and holders figure covered 100 of ~55K launches and 6 of ~480 quote assets ($2M paid, 19K holders on
// /rewards). The ledger is now read in full: pageSize 1000 (the max), PAGES_IN_FLIGHT at a time, until a short page.
// ~55 requests and ~20 MB a read (baseDistributions ride along on the same pages and are dropped), so it is kept per
// instance (over Next's 2 MB data cache): fresh for REWARDS_FRESH_MS, served stale while refreshing up to
// REWARDS_STALE_MS, one walk at a time, each page with its own deadline.
const REWARDS_FRESH_MS = 5 * 60_000;
const REWARDS_STALE_MS = 30 * 60_000;
const REWARDS_TIMEOUT_MS = Number(process.env.REWARDS_TIMEOUT_MS) || 20_000;
const REWARDS_PAGE_SIZE = 1000;
const REWARDS_PAGES_IN_FLIGHT = 4;
const REWARDS_MAX_PAGES = 300;
type RewardsCache = { at: number; data: ApiEnvelope<RewardsResponse> | null; inflight: Promise<ApiEnvelope<RewardsResponse>> | null };
const gRewards = globalThis as typeof globalThis & { __rewardsLedger?: RewardsCache };

type RewardsPage = RewardsResponse & { launchesPagination?: { pageSize?: number } };

async function fetchRewardsPage(page: number): Promise<ApiEnvelope<RewardsPage>> {
  const url = new URL(API_BASE + "/rewards");
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(REWARDS_PAGE_SIZE));
  // recent distributions come with every page; only page 1's are kept
  if (page > 1) url.searchParams.set("limit", "1");
  // a walk is ~55 requests against a 300/min-per-IP limit shared with everything else: back off on 429 / 5xx
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "stonkfun-dashboard/0.1" },
      cache: "no-store",
      signal: AbortSignal.timeout(REWARDS_TIMEOUT_MS),
    });
    if (res.ok) return (await res.json()) as ApiEnvelope<RewardsPage>;
    if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, attempt ? 5000 : 1500));
      continue;
    }
    throw new ApiError(res.status, `${res.status} ${res.statusText} for ${url.pathname} page ${page}`);
  }
}

async function fetchRewardsLedger(): Promise<ApiEnvelope<RewardsResponse>> {
  const first = await fetchRewardsPage(1);
  // an upstream that ignores pageSize (or caps it lower) still pages correctly: a page is "full" at the size it reports
  const size = first.data.launchesPagination?.pageSize ?? REWARDS_PAGE_SIZE;
  const launches = [...first.data.launches];
  let done = first.data.launches.length < size || !first.data.launchesPagination;
  let next = 2;
  while (!done && next <= REWARDS_MAX_PAGES) {
    const batch = Array.from({ length: REWARDS_PAGES_IN_FLIGHT }, (_, i) => next + i).filter((p) => p <= REWARDS_MAX_PAGES);
    next += batch.length;
    const pages = await Promise.all(batch.map(fetchRewardsPage));
    for (const pg of pages) {
      launches.push(...pg.data.launches);
      if (pg.data.launches.length < size) done = true;
    }
  }
  if (!done) throw new Error(`rewards ledger: still full after ${REWARDS_MAX_PAGES} pages — raise REWARDS_MAX_PAGES`);
  // rows can shift between pages while the walk runs (sorted by a total that grows): keep one row per launch
  const seen = new Set<string>();
  const unique = launches.filter((l) => (seen.has(l.mint) ? false : (seen.add(l.mint), true)));
  return { ...first, data: { launches: unique, recentDistributions: first.data.recentDistributions } };
}

export async function getRewards(): Promise<ApiEnvelope<RewardsResponse>> {
  if (USE_FIXTURES) return fixture<RewardsResponse>("rewards");
  const c = (gRewards.__rewardsLedger ??= { at: 0, data: null, inflight: null });
  const refresh = () =>
    (c.inflight ??= fetchRewardsLedger()
      .then((d) => {
        c.data = d;
        c.at = Date.now();
        return d;
      })
      .finally(() => {
        c.inflight = null;
      }));
  const age = Date.now() - c.at;
  if (c.data && age < REWARDS_FRESH_MS) return c.data;
  if (c.data && age < REWARDS_STALE_MS) {
    refresh().catch(() => {});
    return c.data;
  }
  try {
    return await refresh();
  } catch (e) {
    if (c.data) return c.data;
    throw e;
  }
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
    let tokens = [...fx.data.tokens, ...(await communityFixtureTokens())];
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

export async function getToken(mint: string, opts: { fresh?: boolean } = {}): Promise<ApiEnvelope<TokenDetail> | null> {
  if (USE_FIXTURES) {
    const fx = await fixture<TokensResponse>("tokens");
    const t = [...fx.data.tokens, ...(await communityFixtureTokens())].find((x) => x.mint === mint);
    if (!t) return null;
    const lx = await fixture<LaunchesResponse>("launches");
    const launch = lx.data.launches.find((l) => l.mint === mint) ?? null;
    return { data: { token: t, launch, network: fx.data.network }, meta: fx.meta };
  }
  try {
    const res = await get<unknown>(`/tokens/${mint}`, undefined, 30, opts.fresh);
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
async function optional<T>(path: string, revalidate = 60, fixtureName?: string, fresh = false): Promise<T | null> {
  if (USE_FIXTURES) return fixtureName ? (await fixture<T>(fixtureName)).data : null;
  try {
    return (await get<T>(path, undefined, revalidate, fresh)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) return null;
    throw e;
  }
}

export async function getTokenBurns(mint: string, revalidate = 60, opts: { fresh?: boolean } = {}): Promise<TokenBurns | null> {
  if (USE_FIXTURES) {
    if (mint !== STONK_MINT) return null;
    return (await fixture<TokenBurns>("stonk-burns")).data;
  }
  return optional<TokenBurns>(`/tokens/${mint}/burns`, revalidate, undefined, opts.fresh);
}
export const getTokenRewards = (mint: string, opts: { fresh?: boolean } = {}) => optional<TokenRewards>(`/tokens/${mint}/rewards`, 60, mint === STONK_MINT ? "token-rewards-standard" : "token-rewards-reward", opts.fresh);
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
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
