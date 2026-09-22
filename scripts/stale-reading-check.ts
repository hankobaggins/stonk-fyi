// Sanity check for the stale-reading tells: npx tsx scripts/stale-reading-check.ts
import { staleReason } from "../src/lib/stale-reading";
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };

const fresh = { priceUsd: 0.3553, marketCapUsd: 293.64e6, peakMarketCapUsd: 330.81e6 };
const stale = { priceUsd: 0.2602, marketCapUsd: 217.96e6, peakMarketCapUsd: 293.73e6 }; // the Sep-18 record served on 2026-09-22
const circ = 826.39e6;

assert(staleReason(fresh, circ, 0.3566, 330.81e6) === null, "the live reading passes every tell");
assert(staleReason(fresh, circ, null, null) === null, "no reference price and no peak seen → only the supply tell, which passes");
assert(staleReason(stale, circ, null, null)?.code === "supply", "stale record: implied supply 837.6M > 826.4M circulating");
assert(staleReason(stale, 837.59e6, null, 330.81e6)?.code === "peak", "stale burns too (supply agrees) → the peak tell catches it");
assert(staleReason(stale, 837.59e6, 0.3566, null)?.code === "price", "stale burns, no peak seen → the GMGN gap catches it");
assert(staleReason(stale, 837.59e6, null, null) === null, "every tell blind → not flagged (nothing to compare against)");
assert(staleReason({ priceUsd: 0.3553, marketCapUsd: 294.0e6 }, 826.39e6, null, null) === null, "0.1% over circulating (a burn between the two reads) is tolerated");
assert(staleReason(fresh, circ, 0.345, null) === null, "a 3% weekend spread vs GMGN is not stale");
assert(staleReason({}, circ, 0.35, 330e6) === null, "an empty market block is not stale (nothing to judge)");
console.log("all ok");
