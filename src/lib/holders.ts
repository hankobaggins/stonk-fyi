import "server-only";
import { getPairs } from "./api";
import type { Pair } from "./types";

// The tokenized-stock side of StonkFun: the quote assets StonkFun tags xstock / backpack / prestock / tessera.
// Used by the wallet census (lib/wallets.ts) for its issuer masks. The hourly GMGN/StonkFun holder table that
// lived here (§6e) was retired 2026-09-13 when /holders became one table over the whole universe (§6g);
// holder_snapshots (0009) is kept but no longer written.

export const STOCK_CATEGORIES = ["xstock", "backpack", "prestock", "tessera"] as const;
export type StockCategory = (typeof STOCK_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<string, string> = { xstock: "xStocks", backpack: "Backpack", prestock: "Pre-stocks", tessera: "Tessera" };

export function isStockCategory(c?: string | null): c is StockCategory {
  return !!c && (STOCK_CATEGORIES as readonly string[]).includes(c);
}

// Every pair StonkFun tags with a stock category.
export async function getStockQuoteAssets(): Promise<Pair[]> {
  const pairs = await getPairs();
  return pairs.filter((p) => isStockCategory(p.category)).sort((a, b) => a.symbol.localeCompare(b.symbol));
}
