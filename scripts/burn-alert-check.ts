// Sanity check for the big-burn window logic: npx tsx scripts/burn-alert-check.ts
import { findBigBurnWindow } from "../src/lib/burn-window";
const now = Date.parse("2026-09-08T12:10:00Z");
const b = (signature: string, minAgo: number, amountTokens: number) => ({ signature, symbol: "STONK", amountTokens, valueUsdAtBurn: amountTokens * 0.16, source: "buyback", burnedAt: new Date(now - minAgo * 60000).toISOString() });
const burns = [b("A", 2, 40_000), b("B", 6, 30_000), b("C", 30, 600_000)]; // $0.16 each → $6.4K + $4.8K, C $96K but outside the window
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };
assert(findBigBurnWindow(burns, { now })?.valueUsd === 11200, "A+B inside 10 min are worth $11.2K; C (30 min ago) excluded");
assert(findBigBurnWindow(burns, { now, exclude: new Set(["A"]) })?.largest.signature === "C", "A already announced → B alone ($4.8K) is under threshold, so the older $96K window (C) is found instead");
assert(findBigBurnWindow(burns, { now, exclude: new Set(["A", "C"]) }) === null, "A and C announced → B alone is under threshold");
assert(findBigBurnWindow([b("X", 1, 62_000)], { now }) === null, "$9.9K is under threshold");
assert(findBigBurnWindow([b("X", 1, 62_500)], { now })?.burns.length === 1, "a single $10K burn qualifies");
assert(findBigBurnWindow(burns, { now })?.largest.signature === "A", "largest tx picked");
const late = [b("L1", 95, 40_000), b("L2", 98, 30_000)]; // $11.2K window that closed 95 min ago
assert(findBigBurnWindow(late, { now })?.burns.length === 2, "a window that closed 95 min ago is still found (lagging tick)");
assert(findBigBurnWindow([b("S1", 5, 40_000), b("S2", 20, 40_000)], { now }) === null, "two $6.4K burns 15 min apart never share a 10-min window");
