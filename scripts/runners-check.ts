// Offline check of the runners math (§6k): npx tsx --tsconfig tsconfig.json scripts/runners-check.ts
import { collapseLedger, countCohort, countWindow, crossingStatus, linesCrossed, peakOf, RUNNER_LINES, type RunnerRow } from "../src/lib/runner-math";

const assert = (cond: unknown, msg: string) => { if (!cond) { console.error(`FAIL ${msg}`); process.exit(1); } console.log(`ok   ${msg}`); };
const now = Date.parse("2026-09-17T12:00:00Z");
const h = (n: number) => new Date(now - n * 3.6e6).toISOString();

assert(peakOf({ marketCapUsd: 2e6, peakMarketCapUsd: 1.5e6 }) === 2e6, "peak takes the live cap when it beats StonkFun's peak");
assert(linesCrossed(12e6).join() === [1e6, 5e6, 10e6].join(), "lines at or below a $12M peak");
assert(linesCrossed(999_999).length === 0, "nothing below $1M");
assert(crossingStatus(null, h(100), now) === "seeded", "never-seen token older than 36h is seeded");
assert(crossingStatus(null, h(2), now) === "crossed", "never-seen token launched 2h ago is a crossing");
assert(crossingStatus(h(1), h(1000), now) === "crossed", "a token seen before is always a crossing");

const row = (mint: string, line: number, at: number, peak: number, status = "crossed"): RunnerRow => ({ mint, thresholdUsd: line, symbol: mint, name: null, quoteSymbol: "SPYx", createdAt: h(200), reachedAt: h(at), afterTs: h(at + 0.08), mode: "tick", peakUsd: peak, marketCapUsd: peak, status });
const rows = [
  row("A", 1e6, 2, 1.2e6), // 2h ago, $1-5M band
  row("B", 1e6, 30, 7e6), row("B", 5e6, 29, 7e6), // yesterday-ish, $5-10M band
  row("C", 1e6, 100, 30e6), row("C", 5e6, 99, 30e6), row("C", 10e6, 98, 30e6), row("C", 25e6, 97, 30e6), // 4 days ago
  row("D", 5e6, 3, 6e6), // crossed $5M inside the window but $1M before it (seeded or earlier)
  row("E", 1e6, 300, 2e6), // outside 7d
  row("F", 1e6, 5, 1e6, "seeded"), // seeded rows never count
];
const highest = new Map([["A", 1e6], ["B", 5e6], ["C", 25e6], ["D", 5e6], ["E", 1e6], ["F", 1e6]]);
const d1 = countWindow(rows, highest, 24, now);
const d7 = countWindow(rows, highest, 168, now);
assert(d1.crossed.map((c) => c.count).join() === "1,1,0,0,0,0", "24h: A crossed $1M, D crossed $5M");
assert(d7.crossed.map((c) => c.count).join() === "3,3,1,1,0,0", "7d cumulative counts");
assert(d7.bands.map((b) => b.count).join() === "1,1,0,1,0,0", "7d bands: A $1-5M, B $5-10M, C $25-50M; D did not enter in the window");
assert(d7.bands.reduce((s, b) => s + b.count, 0) === d7.crossed[0].count, "bands add up to the $1M+ count");
assert(d7.top.map((r) => r.mint).join() === "C,B,D,A", "top runners by peak, one row per token");
assert(d1.top.length === 2, "24h top has A and D");
assert(countCohort([{ mint: "x", symbol: null, name: null, quoteSymbol: null, createdAt: h(1), peakUsd: 6e6, lastSeenAt: null }]).map((c) => c.count).join() === "1,1,0,0,0,0", "cohort counts are cumulative");
assert(RUNNER_LINES.length === 6, "six lines");
console.log("all good");
{
  const c = collapseLedger(rows.filter((r) => r.mint === "C"));
  assert(c.length === 4 && c[0].lines.length === 1, "collapse keeps separate readings apart");
  const same = collapseLedger([row("Z", 1e6, 1, 7e6), row("Z", 5e6, 1, 7e6)]);
  assert(same.length === 1 && same[0].thresholdUsd === 5e6 && same[0].lines.join() === "1000000,5000000", "collapse merges one reading's lines, highest shown");
}
