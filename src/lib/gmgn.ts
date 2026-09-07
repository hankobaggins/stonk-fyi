import "server-only";
import { STONK_MINT } from "./api";

// GMGN OpenAPI client (https://openapi.gmgn.ai, docs: github.com/GMGNAI/gmgn-skills). Read-only
// routes need X-APIKEY plus timestamp/client_id query params. Rate limit is a 20/s leaky bucket
// (token info/security weight 1, holders weight 5), so results are memoised for 60s per instance.
// Returns null whenever GMGN_API_KEY is unset or any call fails; the site never depends on it.

const HOST = process.env.GMGN_API_BASE ?? "https://openapi.gmgn.ai";
const USE_FIXTURES = process.env.DATA_SOURCE === "fixture";
const TTL_MS = 60_000;

export type GmgnData = {
  priceUsd: number;
  athPriceUsd: number | null;
  holderCount: number;
  liquidityUsd: number;
  biggestPool: { address: string; exchange: string; quoteSymbol: string; liquidityUsd: number } | null;
  vol24h: { buyUsd: number; sellUsd: number; buys: number; sells: number; totalUsd: number };
  vol1h: { buyUsd: number; sellUsd: number; buys: number; sells: number };
  top10HolderRate: number;
  freshWalletRate: number;
  botDegenRate: number;
  wallets: { smart: number; kol: number; whale: number; sniper: number; ratTrader: number };
  security: { mintRenounced: boolean; freezeRenounced: boolean; lpBurned: boolean; lpBurnedPct: number | null; buyTax: number; sellTax: number };
  // Aggregate over the top smart-money holders (up to 20): how much they hold and their lifetime flow.
  smartTop: { n: number; pctHeld: number; buyUsd: number; sellUsd: number; unrealizedUsd: number } | null;
  fetchedAt: string;
};

type Envelope<T> = { code: number; message?: string; data: T };

async function call<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const key = process.env.GMGN_API_KEY;
  if (!key) throw new Error("GMGN_API_KEY not set");
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), timestamp: String(Math.floor(Date.now() / 1000)), client_id: crypto.randomUUID() });
  const res = await fetch(`${HOST}${path}?${q}`, { headers: { "X-APIKEY": key, "User-Agent": "stonk.fyi/1.0" }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`GMGN ${path} ${res.status}`);
  const body = (await res.json()) as Envelope<T>;
  if (body.code !== 0) throw new Error(`GMGN ${path} code ${body.code} ${body.message ?? ""}`);
  return body.data;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(info: any, sec: any, smart: any): GmgnData {
  const p = info.price ?? {};
  const st = info.stat ?? {};
  const tags = info.wallet_tags_stat ?? {};
  const pool = info.pool ?? null;
  const lock = sec?.lock_summary ?? null;
  const lpBurned = sec?.burn_status === "burn" || num(sec?.burn_ratio) >= 0.9;
  const lpBurnedPct = lock?.lock_detail?.length ? Math.max(...lock.lock_detail.map((d: any) => num(d.percent))) * 100 : sec?.burn_ratio ? num(sec.burn_ratio) * 100 : null;
  const list: any[] = smart?.list ?? [];
  const sum = (k: string) => list.reduce((a, x) => a + num(x[k]), 0);
  return {
    priceUsd: num(p.price),
    athPriceUsd: info.ath_price ? num(info.ath_price) : null,
    holderCount: num(info.holder_count ?? st.holder_count),
    liquidityUsd: num(info.liquidity),
    biggestPool: pool ? { address: pool.pool_address, exchange: pool.exchange, quoteSymbol: pool.quote_symbol, liquidityUsd: num(pool.liquidity) } : null,
    vol24h: { buyUsd: num(p.buy_volume_24h), sellUsd: num(p.sell_volume_24h), buys: num(p.buys_24h), sells: num(p.sells_24h), totalUsd: num(p.volume_24h) },
    vol1h: { buyUsd: num(p.buy_volume_1h), sellUsd: num(p.sell_volume_1h), buys: num(p.buys_1h), sells: num(p.sells_1h) },
    top10HolderRate: num(st.top_10_holder_rate ?? sec?.top_10_holder_rate),
    freshWalletRate: num(st.fresh_wallet_rate),
    botDegenRate: num(st.bot_degen_rate),
    wallets: { smart: num(tags.smart_wallets), kol: num(tags.renowned_wallets), whale: num(tags.whale_wallets), sniper: num(tags.sniper_wallets), ratTrader: num(tags.rat_trader_wallets) },
    security: { mintRenounced: !!sec?.renounced_mint, freezeRenounced: !!sec?.renounced_freeze_account, lpBurned, lpBurnedPct, buyTax: num(sec?.buy_tax), sellTax: num(sec?.sell_tax) },
    smartTop: list.length ? { n: list.length, pctHeld: sum("amount_percentage") * 100, buyUsd: sum("buy_volume_cur"), sellUsd: sum("sell_volume_cur"), unrealizedUsd: sum("unrealized_profit") } : null,
    fetchedAt: new Date().toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

let memo: { at: number; data: GmgnData | null } | null = null;

export async function getGmgnStonk(): Promise<GmgnData | null> {
  if (USE_FIXTURES) {
    const mod = await import("@/fixtures/gmgn-stonk.json");
    return (mod.default ?? mod) as GmgnData;
  }
  if (!process.env.GMGN_API_KEY) return null;
  if (memo && Date.now() - memo.at < TTL_MS) return memo.data;
  try {
    const base = { chain: "sol", address: STONK_MINT };
    const [info, sec, smart] = await Promise.all([
      call<unknown>("/v1/token/info", base),
      call<unknown>("/v1/token/security", base).catch(() => null),
      call<unknown>("/v1/market/token_top_holders", { ...base, limit: 20, tag: "smart_degen", order_by: "amount_percentage", direction: "desc" }).catch(() => null),
    ]);
    const data = normalize(info, sec, smart);
    memo = { at: Date.now(), data };
    return data;
  } catch (e) {
    console.error("[gmgn]", e instanceof Error ? e.message : e);
    memo = { at: Date.now(), data: null };
    return null;
  }
}

export const GMGN_TOKEN_URL = `https://gmgn.ai/sol/token/${STONK_MINT}`;
