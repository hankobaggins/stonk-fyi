// Sanity check for the big-burn window logic: npx tsx scripts/burn-alert-check.ts
import { findBigBurnWindow } from "../src/lib/burn-window";
const now = Date.parse("2026-09-11T12:10:00Z");
const b = (signature: string, minAgo: number, amountTokens: number) => ({ signature, symbol: "STONK", amountTokens, valueUsdAtBurn: amountTokens * 0.16, source: "buyback", burnedAt: new Date(now - minAgo * 60000).toISOString() });
const burns = [b("A", 5, 500_000), b("B", 40, 300_000), b("C", 120, 1_000_000)]; // $0.16 each → A $80K + B $48K = $128K; C $160K but two hours back
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };
assert(findBigBurnWindow(burns, { now })?.valueUsd === 128_000, "A+B inside 60 min are worth $128K; C (2 h ago) excluded");
assert(findBigBurnWindow(burns, { now, exclude: new Set(["A"]) })?.largest.signature === "C", "A already announced → B alone ($48K) is under threshold, so the older $160K window (C) is found instead");
assert(findBigBurnWindow(burns, { now, exclude: new Set(["A", "C"]) }) === null, "A and C announced → B alone is under threshold");
assert(findBigBurnWindow([b("X", 1, 749_000)], { now }) === null, "$119.8K is under threshold");
assert(findBigBurnWindow([b("X", 1, 750_000)], { now })?.burns.length === 1, "a single $120K burn qualifies");
assert(findBigBurnWindow(burns, { now })?.largest.signature === "A", "largest tx picked");
const late = [b("L1", 95, 500_000), b("L2", 140, 300_000)]; // $128K window that closed 95 min ago
assert(findBigBurnWindow(late, { now })?.burns.length === 2, "a window that closed 95 min ago is still found (lagging tick)");
assert(findBigBurnWindow([b("S1", 5, 400_000), b("S2", 70, 400_000)], { now }) === null, "two $64K burns 65 min apart never share a 60-min window");
