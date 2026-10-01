import "server-only";
import { getPairs, getTokens, getTopTokens, STONK_MINT, UPSTREAM_TIMEOUT_MS, USE_FIXTURES } from "./api";
import type { Pair, Token } from "./types";
import { categoryLabel } from "./universe";
import {
  countVenues,
  darkAfterClose,
  groupSameAsset,
  isStockCategory,
  oracleFor,
  underlyingTicker,
  type IssuerGroup,
  type Oracle,
  type PythFeedLists,
} from "./quote-math";

// Quote assets as markets in their own right (§6m, 2026-09-29, from the stonkpile.xyz comparison): the asset's own
// liquidity, holders and venues, whether Pyth prices it after the close, what StonkFun coins are priced in it, and the
// same asset listed by two issuers at two prices. Three keyless upstreams, all best-effort (null on failure):
//   Jupiter tokens v2  lite-api.jup.ag/tokens/v2/search?query=<≤100 mints>   price, liquidity (all pools), holders, 24h volume
//   Pyth Hermes        hermes.pyth.network/v2/price_feeds?asset_type=…       which tickers have a feed (the price routes need a key)
//   DexScreener        api.dexscreener.com/token-pairs/v1/solana/<mint>       every pair → venues
// Fixture mode serves captured subsets (jupiter-tokens.json, pyth-feeds.json, dex-venues.json).

const JUP = "https://lite-api.jup.ag/tokens/v2/search";
const HERMES = "https://hermes.pyth.network/v2/price_feeds";
const DEX = "https://api.dexscreener.com/token-pairs/v1/solana";

export type JupToken = {
  mint: string;
  symbol: string;
  name: string;
  icon?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  holders?: number;
  mcapUsd?: number;
  volume24hUsd?: number;
  priceChange24h?: number;
  verified?: boolean;
  mintAuthority?: boolean;
  freezeAuthority?: boolean;
};

type JupRaw = {
  id: string;
  symbol: string;
  name: string;
  icon?: string;
  usdPrice?: number;
  liquidity?: number;
  holderCount?: number;
  mcap?: number;
  isVerified?: boolean;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number };
};

let lastErr: string | null = null;
export const lastQuoteAssetError = () => lastErr;

async function fixtureJson<T>(name: string): Promise<T> {
  const mod = await import(`@/fixtures/${name}.json`);
  return (mod.default ?? mod) as T;
}

// Jupiter's token records for up to any number of mints, 100 per request, 5 min cache. Missing mints are absent.
export async function getJupiterTokens(mints: string[]): Promise<Map<string, JupToken>> {
  const out = new Map<string, JupToken>();
  const uniq = [...new Set(mints)].sort();
  if (USE_FIXTURES) {
    const fx = await fixtureJson<{ tokens: JupToken[] }>("jupiter-tokens");
    for (const t of fx.tokens) if (uniq.includes(t.mint)) out.set(t.mint, t);
    return out;
  }
  for (let i = 0; i < uniq.length; i += 100) {
    const ids = uniq.slice(i, i + 100);
    try {
      const res = await fetch(`${JUP}?query=${ids.join(",")}`, { headers: { accept: "application/json" }, next: { revalidate: 300 }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`jupiter tokens ${res.status}`);
      const data = (await res.json()) as JupRaw[];
      if (!Array.isArray(data)) throw new Error("jupiter tokens: unexpected shape");
      for (const t of data) {
        if (!t?.id) continue;
        const s = t.stats24h;
        out.set(t.id, {
          mint: t.id,
          symbol: t.symbol,
          name: t.name,
          icon: t.icon,
          priceUsd: t.usdPrice,
          liquidityUsd: t.liquidity,
          holders: t.holderCount,
          mcapUsd: t.mcap,
          volume24hUsd: s ? (s.buyVolume ?? 0) + (s.sellVolume ?? 0) : undefined,
          priceChange24h: s?.priceChange,
          verified: t.isVerified,
          mintAuthority: !!t.mintAuthority,
          freezeAuthority: !!t.freezeAuthority,
        });
      }
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return out;
}

type HermesFeed = { attributes?: { symbol?: string } };

// Tickers with a Pyth feed, by kind. Hermes lists ~1,250 equity and ~420 crypto feeds; the lists change rarely, so 6 h.
export async function getPythFeeds(): Promise<PythFeedLists | null> {
  if (USE_FIXTURES) return fixtureJson<PythFeedLists>("pyth-feeds");
  try {
    const read = async (type: string) => {
      const res = await fetch(`${HERMES}?asset_type=${type}`, { headers: { accept: "application/json" }, next: { revalidate: 21_600 }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`pyth ${type} ${res.status}`);
      const data = (await res.json()) as HermesFeed[];
      if (!Array.isArray(data)) throw new Error(`pyth ${type}: unexpected shape`);
      return data.map((f) => f.attributes?.symbol ?? "");
    };
    const [eq, cr] = await Promise.all([read("equity"), read("crypto")]);
    const pick = (list: string[], re: RegExp) => [...new Set(list.map((s) => s.match(re)?.[1]).filter((s): s is string => !!s))];
    return {
      us: pick(eq, /^Equity\.US\.([^/]+)\/USD$/),
      index: pick(eq, /^Equity\.Index\.([^/]+)\/USD$/),
      crypto: pick(cr, /^Crypto\.([^/]+)\/USD$/),
    };
  } catch (e) {
    lastErr = (e as Error).message;
    return null;
  }
}

export type Venues = { pairs: number; dex: Record<string, number>; venues: string[] };

type DexPair = { dexId?: string; liquidity?: { usd?: number } };

// Every DexScreener pair the asset is in, summed by DEX. One request, 5 min cache; asset page only.
export async function getVenues(mint: string): Promise<Venues | null> {
  if (USE_FIXTURES) {
    const fx = await fixtureJson<Record<string, { pairs: number; dex: Record<string, number> }>>("dex-venues");
    const v = fx[mint];
    return v ? { ...v, venues: countVenues(v.dex) } : null;
  }
  try {
    const res = await fetch(`${DEX}/${mint}`, { headers: { accept: "application/json" }, next: { revalidate: 300 }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const data = (await res.json()) as DexPair[];
    if (!Array.isArray(data)) throw new Error("dexscreener: unexpected shape");
    const dex: Record<string, number> = {};
    for (const p of data) if (p.dexId) dex[p.dexId] = (dex[p.dexId] ?? 0) + (p.liquidity?.usd ?? 0);
    return { pairs: data.length, dex, venues: countVenues(dex) };
  } catch (e) {
    lastErr = (e as Error).message;
    return null;
  }
}

// ---------- the board: every stock quote asset StonkFun lists ----------

export type QuoteAssetRow = {
  mint: string;
  symbol: string; // StonkFun's
  jupSymbol: string | null;
  name: string;
  category: string;
  categoryLabel: string;
  logoUrl?: string;
  ticker: string;
  oracle: Oracle | null; // null when Pyth's lists could not be read
  priceUsd: number | null;
  liquidityUsd: number | null; // Jupiter, every pool the asset is in
  holders: number | null; // Jupiter
  volume24hUsd: number | null; // the asset's own, Jupiter
  coins: number; // StonkFun coins priced in it among the most-traded 300
  coinVolume: number; // their 24h volume
  coinMcap: number;
  topCoin: { mint: string; symbol: string; volume: number } | null;
};

export type QuoteBoard = {
  rows: QuoteAssetRow[]; // stock categories, every listed pair
  used: QuoteAssetRow[]; // the ones with a coin among the most-traded 300
  sample: number; // tokens aggregated
  feedsOk: boolean;
  jupOk: boolean;
  gap: {
    equities: number; // used, excluding crypto-classified
    dark: number; // …of which no price after the close
    dark247Proxy: number; // …proxy only
    darkVolume: number; // 24h volume of StonkFun coins quoted in the dark ones
    equityVolume: number;
  } | null;
  groups: IssuerGroup[];
};

export async function getQuoteBoard(sampleTokens?: Token[]): Promise<QuoteBoard> {
  const [pairs, tokens, feeds] = await Promise.all([getPairsWithExtras(), sampleTokens ? Promise.resolve(sampleTokens) : getTopTokens(300, "volume"), getPythFeeds()]);
  const stock = pairs.filter((p) => isStockCategory(p.category));
  const jup = await getJupiterTokens(stock.map((p) => p.mint));
  const usage = new Map<string, { coins: number; volume: number; mcap: number; top: QuoteAssetRow["topCoin"] }>();
  for (const t of tokens) {
    const u = usage.get(t.quote.mint) ?? { coins: 0, volume: 0, mcap: 0, top: null };
    const v = t.market?.volume24hUsd ?? 0;
    u.coins++;
    u.volume += v;
    u.mcap += t.market?.marketCapUsd ?? 0;
    if (!u.top || v > u.top.volume) u.top = { mint: t.mint, symbol: t.symbol, volume: v };
    usage.set(t.quote.mint, u);
  }
  const rows: QuoteAssetRow[] = stock.map((p) => toRow(p, jup.get(p.mint), feeds, usage.get(p.mint)));
  const used = rows.filter((r) => r.coins > 0).sort((a, b) => b.coinVolume - a.coinVolume);
  let gap: QuoteBoard["gap"] = null;
  if (feeds) {
    const eq = used.filter((r) => r.oracle && r.oracle.state !== "crypto");
    const dark = eq.filter((r) => r.oracle && darkAfterClose(r.oracle.state));
    gap = {
      equities: eq.length,
      dark: dark.length,
      dark247Proxy: eq.filter((r) => r.oracle?.state === "proxy").length,
      darkVolume: dark.reduce((s, r) => s + r.coinVolume, 0),
      equityVolume: eq.reduce((s, r) => s + r.coinVolume, 0),
    };
  }
  const groups = groupSameAsset(
    rows.map((r) => ({ mint: r.mint, symbol: r.jupSymbol ?? r.symbol, name: r.name, category: r.category, priceUsd: r.priceUsd, liquidityUsd: r.liquidityUsd, volume24hUsd: r.volume24hUsd, ticker: r.ticker })),
    feeds ?? undefined,
  );
  return { rows, used, sample: tokens.length, feedsOk: !!feeds, jupOk: jup.size > 0, gap, groups };
}

function toRow(p: Pair, j: JupToken | undefined, feeds: PythFeedLists | null, u?: { coins: number; volume: number; mcap: number; top: QuoteAssetRow["topCoin"] }): QuoteAssetRow {
  const ticker = underlyingTicker(p, j?.symbol);
  return {
    mint: p.mint,
    symbol: p.symbol,
    jupSymbol: j?.symbol ?? null,
    name: p.name ?? p.symbol,
    category: p.category ?? "other",
    categoryLabel: categoryLabel(p.category, p.categoryLabel),
    logoUrl: p.logoUrl,
    ticker,
    oracle: feeds ? oracleFor(ticker, p.category, feeds) : null,
    priceUsd: j?.priceUsd ?? null,
    liquidityUsd: j?.liquidityUsd ?? null,
    holders: j?.holders ?? null,
    volume24hUsd: j?.volume24hUsd ?? null,
    coins: u?.coins ?? 0,
    coinVolume: u?.volume ?? 0,
    coinMcap: u?.mcap ?? 0,
    topCoin: u?.top ?? null,
  };
}

// Fixture pairs are derived from tokens.json, which quotes no pre-IPO asset twice; two real rows are added so the
// cross-issuer check renders offline.
async function getPairsWithExtras(): Promise<Pair[]> {
  const pairs = await getPairs();
  if (!USE_FIXTURES) return pairs;
  const fx = await fixtureJson<{ pairs: Pair[] }>("pairs-extra");
  return [...pairs, ...fx.pairs.filter((x) => !pairs.some((p) => p.mint === x.mint))];
}

// ---------- one asset ----------

export type QuoteCoin = {
  mint: string;
  symbol: string;
  name: string;
  mode?: string;
  status: string;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null; // Jupiter, all pools
  holders: number | null; // Jupiter
  turnover: number | null;
  platform: boolean; // STONK itself: the launchpad's own token
};

export type QuoteAssetDetail = {
  pair: Pair;
  row: QuoteAssetRow;
  jup: JupToken | null;
  venues: Venues | null;
  coins: QuoteCoin[];
  coinsTotal: number; // every StonkFun coin quoted in it (API pagination total)
  shownVolume: number;
  group: IssuerGroup | null;
  feedsOk: boolean;
};

export async function getQuoteAssetDetail(mint: string): Promise<QuoteAssetDetail | null> {
  const pairs = await getPairsWithExtras();
  const pair = pairs.find((p) => p.mint === mint);
  if (!pair) return null;
  const stock = isStockCategory(pair.category);
  const [coinsRes, venues, board, feeds] = await Promise.all([
    getTokens({ quoteMint: mint, sort: "volume", pageSize: 25 }).catch(() => null),
    getVenues(mint),
    stock ? getQuoteBoard().catch(() => null) : Promise.resolve(null),
    getPythFeeds(),
  ]);
  const list = coinsRes?.data.tokens ?? [];
  const jup = await getJupiterTokens([mint, ...list.map((t) => t.mint)]);
  const usage = { coins: coinsRes?.data.pagination.total ?? list.length, volume: list.reduce((s, t) => s + (t.market?.volume24hUsd ?? 0), 0), mcap: list.reduce((s, t) => s + (t.market?.marketCapUsd ?? 0), 0), top: null };
  const row = toRow(pair, jup.get(mint), feeds, usage);
  const coins: QuoteCoin[] = list.map((t) => {
    const j = jup.get(t.mint);
    const liq = j?.liquidityUsd ?? null;
    const vol = t.market?.volume24hUsd ?? null;
    return {
      mint: t.mint,
      symbol: t.symbol,
      name: t.name,
      mode: t.mode,
      status: t.status,
      marketCapUsd: t.market?.marketCapUsd ?? null,
      volume24hUsd: vol,
      priceChange24h: t.market?.priceChange24h ?? null,
      liquidityUsd: liq,
      holders: j?.holders ?? null,
      turnover: liq && vol != null ? vol / liq : null,
      platform: t.mint === STONK_MINT,
    };
  });
  const group = board?.groups.find((g) => g.members.some((m) => m.mint === mint)) ?? null;
  return { pair, row, jup: jup.get(mint) ?? null, venues, coins, coinsTotal: usage.coins, shownVolume: usage.volume, group, feedsOk: !!feeds };
}
