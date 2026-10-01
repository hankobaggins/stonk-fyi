// Pure logic for the quote-asset pages (§6m, 2026-09-29): which underlying a StonkFun quote asset tracks, whether
// Pyth publishes a reference price for it after the close, the plain-language checks on the asset page, and
// the same asset listed by two issuers at two prices. No I/O here; scripts/quote-assets-check.ts exercises it.

// StonkFun's /pairs categories that are tokenized equity (public or pre-IPO). Backpack also lists crypto
// (TAO, DOGE, ARB…); those are told apart by the Pyth feed lists, not the category.
export const STOCK_CATEGORIES = ["xstock", "backpack", "prestock", "tessera"] as const;
export const isStockCategory = (c?: string) => !!c && (STOCK_CATEGORIES as readonly string[]).includes(c);

export type PythFeedLists = { us: string[]; index: string[]; crypto: string[] };

// Pyth publishes two kinds of equity feed: Equity.US.<T>/USD follows the exchange session and stops at the close;
// Equity.Index.<T>/USD is described by Pyth as "24/7". An ETF with no 24/7 feed of its own can still have an index
// that moves with it (SPY → the S&P 500), which is a proxy, not the same instrument.
export const INDEX_PROXY: Record<string, string> = { SPY: "US500", VOO: "US500", QQQ: "US100", DIA: "US30" };

// "247": an always-on Pyth feed for this ticker. "proxy": only an index that tracks it is always-on.
// "hours": a feed that stops at the close. "none": no Pyth feed at all. "crypto": not an equity (a Backpack-listed
// coin with a crypto feed and no equity feed), outside the oracle-gap count.
export type OracleState = "247" | "proxy" | "hours" | "none" | "crypto";
export type Oracle = { state: OracleState; feed: string | null };

// Underlying ticker. xStocks: Jupiter's symbol without the trailing lowercase x (StonkFun upper-cases symbols and has
// at least one typo — APPLX for AAPLx — so its symbol is the fallback only). Other issuers: StonkFun's symbol, which for
// Backpack and the pre-IPO issuers is the ticker or the company (Jupiter's can collide: Backpack's RoboStrategy is
// "BOT" there, a different listed security in Pyth).
export function underlyingTicker(p: { symbol: string; category?: string }, jupSymbol?: string | null): string {
  const s = p.symbol.toUpperCase();
  if (p.category === "xstock") {
    if (jupSymbol && /x$/.test(jupSymbol)) return jupSymbol.slice(0, -1).toUpperCase();
    return s.endsWith("X") ? s.slice(0, -1) : s;
  }
  return s;
}

export function oracleFor(ticker: string, category: string | undefined, feeds: PythFeedLists): Oracle {
  const has = (list: string[], t: string) => list.includes(t);
  if (has(feeds.index, ticker)) return { state: "247", feed: `Equity.Index.${ticker}/USD` };
  const us = has(feeds.us, ticker);
  // A Backpack symbol with a crypto feed and no equity feed is a coin, not a stock.
  if (!us && category === "backpack" && has(feeds.crypto, ticker)) return { state: "crypto", feed: `Crypto.${ticker}/USD` };
  const proxy = INDEX_PROXY[ticker];
  if (proxy && has(feeds.index, proxy)) return { state: "proxy", feed: `Equity.Index.${proxy}/USD` };
  if (us) return { state: "hours", feed: `Equity.US.${ticker}/USD` };
  return { state: "none", feed: null };
}

export const ORACLE_LABEL: Record<OracleState, string> = { "247": "24/7", proxy: "index proxy", hours: "market hours", none: "none", crypto: "crypto" };
// True when a coin priced in this asset has nothing independent to price against once the closing bell goes.
export const darkAfterClose = (s: OracleState) => s === "hours" || s === "none";

// ---------- checks on the asset page ----------

export type CheckState = "bull" | "neutral" | "bear" | "info";
export type Check = { key: string; label: string; value: string; state: CheckState; detail: string };

export function liquidityState(usd: number | null): CheckState {
  if (usd == null) return "info";
  return usd >= 1_000_000 ? "bull" : usd >= 100_000 ? "neutral" : "bear";
}
export function holdersState(n: number | null): CheckState {
  if (n == null) return "info";
  return n >= 10_000 ? "bull" : n >= 1_000 ? "neutral" : "bear";
}
export function venuesState(n: number | null): CheckState {
  if (n == null) return "info";
  return n >= 3 ? "bull" : n === 2 ? "neutral" : "bear";
}
export function oracleState(s: OracleState): CheckState {
  return s === "247" || s === "crypto" ? "bull" : s === "proxy" ? "neutral" : "bear";
}

// Venues: distinct DEXes with at least this much liquidity behind the asset's pairs (DexScreener counts both sides).
export const VENUE_MIN_USD = 1_000;
export function countVenues(dex: Record<string, number>): string[] {
  return Object.entries(dex)
    .filter(([, usd]) => usd >= VENUE_MIN_USD)
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);
}

// Turnover = 24h volume ÷ liquidity. Far above ~5× is churn faster than organic demand usually trades.
export const CHURN_TURNOVER = 5;
export function turnover(volume: number | null | undefined, liquidity: number | null | undefined): number | null {
  if (volume == null || !liquidity || liquidity <= 0) return null;
  return volume / liquidity;
}

// ---------- same asset, several issuers ----------

export type IssuerQuote = { mint: string; symbol: string; name?: string; category: string; priceUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null };
export type IssuerGroup = { key: string; members: IssuerQuote[]; spreadPct: number | null; anyPublicFeed: boolean };

// Keys an asset under both its ticker and its name (upper-cased, alphanumerics only), and joins assets from different
// issuers that share either key (union-find). Only stock categories take part, and a group needs ≥2 issuers.
export function assetKeys(a: { symbol: string; name?: string; category: string }, ticker: string): string[] {
  const keys = new Set<string>([ticker]);
  const n = (a.name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (n.length >= 3) keys.add(n);
  return [...keys];
}

export function groupSameAsset(assets: (IssuerQuote & { ticker: string })[], feeds?: PythFeedLists): IssuerGroup[] {
  const stock = assets.filter((a) => isStockCategory(a.category));
  const parent = stock.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map<string, number>();
  stock.forEach((a, i) => {
    for (const k of assetKeys(a, a.ticker)) {
      const j = seen.get(k);
      if (j === undefined) seen.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, (IssuerQuote & { ticker: string })[]>();
  stock.forEach((a, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), a]));
  const out: IssuerGroup[] = [];
  for (const members of groups.values()) {
    if (new Set(members.map((m) => m.category)).size < 2) continue;
    const prices = members.map((m) => m.priceUsd).filter((p): p is number => p != null && p > 0);
    const spreadPct = prices.length >= 2 ? ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100 : null;
    const key = members.map((m) => m.ticker).sort((a, b) => a.length - b.length)[0];
    const anyPublicFeed = !!feeds && members.some((m) => feeds.us.includes(m.ticker));
    out.push({ key, members: [...members].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)), spreadPct, anyPublicFeed });
  }
  return out.sort((a, b) => (b.spreadPct ?? -1) - (a.spreadPct ?? -1));
}

// Is the US equity market in session (Mon–Fri 09:30–16:00 America/New_York; holidays ignored)? A session-only feed
// is live only then.
export function usMarketOpen(ts: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// The asset page's checks, in reading order. Arithmetic on public data, not a verdict on the asset.
export type CheckInput = {
  symbol: string;
  ticker: string;
  issuerLabel: string;
  verified: boolean | null;
  liquidityUsd: number | null;
  holders: number | null;
  venues: string[] | null;
  oracle: Oracle | null;
  mintAuthority: boolean | null;
  freezeAuthority: boolean | null;
  marketOpen: boolean;
};

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`);

export function buildChecks(i: CheckInput): Check[] {
  const out: Check[] = [];
  out.push({
    key: "issuer",
    label: "Issuer",
    value: i.issuerLabel,
    state: i.verified === false ? "bear" : i.verified ? "bull" : "info",
    detail:
      i.verified === false
        ? `StonkFun lists this mint as a quote asset under ${i.issuerLabel}, but Jupiter does not mark it verified. Check the address before trusting a same-named token.`
        : `StonkFun lists this mint as a quote asset under ${i.issuerLabel}${i.verified ? " and Jupiter marks it verified" : ""}. A token with the same name at another address is not it.`,
  });
  const ls = liquidityState(i.liquidityUsd);
  out.push({
    key: "liquidity",
    label: "Liquidity",
    value: i.liquidityUsd == null ? "unavailable" : usd(i.liquidityUsd),
    state: ls,
    detail:
      ls === "bull" ? "Deep enough that an ordinary trade barely moves the price, across every pool it trades in."
        : ls === "neutral" ? "Moderate depth: larger trades move the price, and the coins priced in it inherit that."
        : ls === "bear" ? "Thin. A modest trade moves the price, and every coin priced in it is quoted off that price."
        : "Jupiter did not return a liquidity figure for this mint.",
  });
  if (i.oracle) {
    const o = i.oracle;
    out.push({
      key: "oracle",
      label: "Reference price",
      value: o.state === "247" ? "24/7" : o.state === "proxy" ? "Index proxy only" : o.state === "hours" ? (i.marketOpen ? "Market hours · live" : "Market hours · closed") : o.state === "crypto" ? "Crypto, 24/7" : "None",
      state: oracleState(o.state),
      detail:
        o.state === "247" ? `Pyth publishes an always-on ${i.ticker} price (${o.feed}), so the on-chain quote has something to be checked against after the close too.`
        : o.state === "proxy" ? `Pyth prices ${i.ticker} only during the US session. The always-on index feed (${o.feed}) moves with it but is not the same instrument, so after the close ${i.symbol} is checked against a proxy at best.`
        : o.state === "hours" ? `Pyth publishes ${i.ticker} only during the US session (09:30–16:00 ET). ${i.marketOpen ? "It is live now; after" : "It is closed now: after"} the bell and at weekends nothing independent prices ${i.symbol}, which is when on-chain quotes drift furthest from fair value.`
        : o.state === "crypto" ? `Listed by Backpack, but a crypto asset: Pyth prices it around the clock (${o.feed}).`
        : `Pyth publishes no feed for ${i.ticker} at all. The on-chain price is the only price, at any hour.`,
    });
  }
  const n = i.venues?.length ?? null;
  const vs = venuesState(n);
  out.push({
    key: "venues",
    label: "Venues",
    value: n == null ? "unavailable" : `${n} DEX${n === 1 ? "" : "es"}`,
    state: vs,
    detail:
      n == null ? "DexScreener did not answer for this mint."
        : `${i.venues!.join(", ") || "none"}. ` + (vs === "bull" ? "Several venues, so one pool drying up does not end its market." : vs === "neutral" ? "Two venues." : "One venue: if that pool empties, so does the market."),
  });
  const hs = holdersState(i.holders);
  out.push({
    key: "holders",
    label: "Holders",
    value: i.holders == null ? "unavailable" : i.holders.toLocaleString("en-US"),
    state: hs,
    detail: hs === "bull" ? "Widely held." : hs === "neutral" ? "A few thousand wallets." : hs === "bear" ? "Few holders: a handful of wallets can move it." : "Jupiter did not return a holder count.",
  });
  if (i.mintAuthority != null) {
    const both = i.mintAuthority && i.freezeAuthority;
    out.push({
      key: "authority",
      label: "Issuer controls",
      value: both ? "mint · freeze" : i.mintAuthority ? "mint" : i.freezeAuthority ? "freeze" : "renounced",
      state: "info",
      detail: i.mintAuthority || i.freezeAuthority
        ? "Normal for a tokenized stock: the issuer mints against deposits and can freeze an account for compliance. It also means the token is a claim on the issuer, not the share itself."
        : "Mint and freeze authority are renounced: supply is fixed and no account can be frozen.",
    });
  }
  return out;
}
