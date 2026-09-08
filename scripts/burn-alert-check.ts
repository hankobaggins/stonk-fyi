// Sanity check for the big-burn window logic: npx tsx scripts/burn-alert-check.ts
import { findBigBurnWindow } from "../src/lib/burn-window";
const now = Date.parse("2026-09-08T12:10:00Z");
const b = (signature: string, minAgo: number, amountTokens: number) => ({ signature, symbol: "STONK", amountTokens, valueUsdAtBurn: amountTokens * 0.16, source: "buyback", burnedAt: new Date(now - minAgo * 60000).toISOString() });
const burns = [b("A", 2, 200_000), b("B", 6, 150_000), b("C", 30, 600_000)]; // $0.16 each → $32K + $24K, C $96K but outside the window
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };
assert(findBigBurnWindow(burns, { now })?.valueUsd === 56000, "A+B inside 10 min are worth $56K; C (30 min ago) excluded");
assert(findBigBurnWindow(burns, { now, exclude: new Set(["A"]) }) === null, "A already announced → B alone ($24K) is under threshold");
assert(findBigBurnWindow([b("X", 1, 312_000)], { now }) === null, "$49.9K is under threshold");
assert(findBigBurnWindow([b("X", 1, 312_500)], { now })?.burns.length === 1, "a single $50K burn qualifies");
assert(findBigBurnWindow(burns, { now })?.largest.signature === "A", "largest tx picked");
