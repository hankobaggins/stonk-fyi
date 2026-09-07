import "server-only";
import type { PoolInfo } from "./types";

const USE_FIXTURES = process.env.DATA_SOURCE === "fixture";
const RAYDIUM_API = process.env.RAYDIUM_API_BASE ?? "https://api-v3.raydium.io";

// Raydium's public pool-info endpoint: live reserves, TVL, fee rate and 24h volume for a pool id.
// Best-effort — returns null on any failure so callers degrade gracefully.
export async function getPoolInfo(poolId: string): Promise<PoolInfo | null> {
  try {
    let raw: { success?: boolean; data?: PoolInfo[] };
    if (USE_FIXTURES) {
      raw = (await import("@/fixtures/raydium-pool.json")).default as typeof raw;
    } else {
      const res = await fetch(`${RAYDIUM_API}/pools/info/ids?ids=${poolId}`, {
        headers: { accept: "application/json" },
        next: { revalidate: 60 },
      });
      if (!res.ok) return null;
      raw = (await res.json()) as typeof raw;
    }
    const p = raw.data?.[0];
    return p && p.id === poolId ? p : null;
  } catch {
    return null;
  }
}

// Which side of the pool is STONK, and the USD value of each side given a STONK USD price.
export function poolSides(p: PoolInfo, stonkMint: string, stonkPriceUsd?: number) {
  const stonkIsA = p.mintA.address === stonkMint;
  const stonkReserve = stonkIsA ? p.mintAmountA : p.mintAmountB;
  const quoteReserve = stonkIsA ? p.mintAmountB : p.mintAmountA;
  const quote = stonkIsA ? p.mintB : p.mintA;
  const stonkSideUsd = stonkPriceUsd ? stonkReserve * stonkPriceUsd : undefined;
  const quoteSideUsd = stonkSideUsd !== undefined ? Math.max(0, p.tvl - stonkSideUsd) : undefined;
  return { stonkReserve, quoteReserve, quote, stonkSideUsd, quoteSideUsd };
}
