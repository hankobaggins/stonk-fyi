import "server-only";

// USD prices for arbitrary Solana mints via Jupiter's public price API (no key, 50 ids per call).
// Used to value holder rewards, which StonkFun reports only in native quote units. Best-effort:
// unknown mints are simply absent from the result.
const BASE = "https://lite-api.jup.ag/price/v3";

export async function getUsdPrices(mints: string[], revalidate = 300): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (process.env.DATA_SOURCE === "fixture") return out;
  const uniq = [...new Set(mints)].sort();
  for (let i = 0; i < uniq.length; i += 50) {
    const ids = uniq.slice(i, i + 50);
    try {
      const res = await fetch(`${BASE}?ids=${ids.join(",")}`, { headers: { accept: "application/json" }, next: { revalidate } });
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, { usdPrice?: number }>;
      for (const [mint, v] of Object.entries(data ?? {})) if (typeof v?.usdPrice === "number") out[mint] = v.usdPrice;
    } catch {
      // one failed batch should not blank the rest
    }
  }
  return out;
}
