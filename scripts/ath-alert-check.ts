// Sanity check for the ATH math: npx tsx scripts/ath-alert-check.ts
import { athCandidate, evaluateAth } from "../src/lib/ath-math";
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };
const T0 = "2026-09-10T12:00:00Z";
const min = (m: number) => new Date(Date.parse(T0) + m * 60000).toISOString();

assert(athCandidate(130e6, 185e6)?.source === "stonkfun-peak" && athCandidate(130e6, 185e6)?.value === 185e6, "StonkFun's peak wins when live mcap is below it");
assert(athCandidate(190e6, 185e6)?.source === "live-mcap", "live mcap wins when it is above StonkFun's peak (their peak can lag)");
assert(athCandidate(null, 185e6)?.value === 185e6 && athCandidate(130e6, undefined)?.value === 130e6, "one missing reading → use the other");
assert(athCandidate(null, null) === null && athCandidate(0, 0) === null, "no usable reading → null");

assert(evaluateAth(185e6, 185e6, null, T0).newHigh === false, "equal to the previous high is not a new high");
assert(evaluateAth(184e6, 185e6, null, T0).newHigh === false, "below the previous high → nothing");
assert(evaluateAth(190e6, null, null, T0).newHigh === false, "empty ledger → seed, never post");
const first = evaluateAth(190e6, 185e6, null, T0);
assert(first.newHigh && first.announce && Math.abs((first.gainPct ?? 0) - 2.7027) < 0.01, "first break of the ATH posts, gain vs previous computed");
const inCooldown = evaluateAth(191e6, 190e6, T0, min(20), 60);
assert(inCooldown.newHigh && !inCooldown.announce, "new high 20 min after a post → recorded quiet, not posted");
const afterCooldown = evaluateAth(192e6, 191e6, T0, min(60), 60);
assert(afterCooldown.newHigh && afterCooldown.announce, "new high 60 min after the post → posted");
assert(evaluateAth(191.5e6, 192e6, T0, min(90), 60).newHigh === false, "after the cooldown a figure below the quiet high is not a new high");
