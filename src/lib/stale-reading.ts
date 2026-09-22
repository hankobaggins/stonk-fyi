// Is StonkFun's STONK record stale? (2026-09-22: one of their backends intermittently served a
// Sep-18 record — price $0.2602 vs $0.3553 live, 37% off — with a fresh meta.generatedAt.)
// Three independent tells, any one of which marks the reading; none needs a network call.
// Pure: checked by scripts/stale-reading-check.ts.

export type StaleReason = { code: "supply" | "peak" | "price"; detail: string };

// Implied supply (mcap ÷ price) may exceed the burn ledger's circulating supply by this much:
// rounding plus the burns that land between the two reads.
export const SUPPLY_TOLERANCE = 0.005;
// StonkFun (pool ratio × SPYx) vs GMGN's SOL-pool price. Normal spread is under 1%; weekend SPYx
// drift a few %; the stale record was 37% off.
export const PRICE_TOLERANCE = 0.1;
// A peak is a lifetime high and only rises; anything below one already seen is an older record.
export const PEAK_TOLERANCE = 0.001;

type Market = { priceUsd?: number; marketCapUsd?: number; peakMarketCapUsd?: number };

export function staleReason(m: Market, circulating: number | null, refPriceUsd: number | null, peakSeenUsd: number | null): StaleReason | null {
  const price = m.priceUsd ?? 0;
  const mcap = m.marketCapUsd ?? 0;
  if (price > 0 && mcap > 0 && circulating && circulating > 0) {
    const implied = mcap / price;
    if (implied > circulating * (1 + SUPPLY_TOLERANCE)) {
      return { code: "supply", detail: `market cap ÷ price implies ${fmtM(implied)} STONK in circulation, ${fmtM(implied - circulating)} more than the burn ledger allows` };
    }
  }
  const peak = m.peakMarketCapUsd ?? 0;
  if (peak > 0 && peakSeenUsd && peak < peakSeenUsd * (1 - PEAK_TOLERANCE)) {
    return { code: "peak", detail: `peak market cap $${fmtM(peak)} is below the $${fmtM(peakSeenUsd)} already recorded` };
  }
  if (price > 0 && refPriceUsd && refPriceUsd > 0) {
    const gap = price / refPriceUsd - 1;
    if (Math.abs(gap) > PRICE_TOLERANCE) {
      return { code: "price", detail: `$${price.toFixed(4)} vs $${refPriceUsd.toFixed(4)} on GMGN (${gap >= 0 ? "+" : "−"}${(Math.abs(gap) * 100).toFixed(0)}%)` };
    }
  }
  return null;
}

const fmtM = (n: number) => `${(n / 1e6).toFixed(2)}M`;
