// Sanity check for the milestone math: npx tsx scripts/burn-milestone-check.ts
import { findCrossing, milestoneFloor, newMilestones } from "../src/lib/milestone-math";
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };
assert(milestoneFloor(12.99) === 12 && milestoneFloor(13) === 13 && milestoneFloor(13.7) === 13, "floor to the whole percent");
assert(newMilestones(13.4, 13).length === 0, "13.4% with 13 recorded → nothing new");
assert(JSON.stringify(newMilestones(14.02, 13)) === "[14]", "14.02% with 13 recorded → 14");
assert(JSON.stringify(newMilestones(16.5, 13)) === "[14,15,16]", "worker down for days → 14, 15, 16 (only 16 is posted)");
assert(newMilestones(14.5, null).length === 0, "empty ledger → seed, never post");
const S = 1_000_000_000;
const b = (signature: string, minAgo: number, amountTokens: number) => ({ signature, symbol: "STONK", amountTokens, valueUsdAtBurn: 0, source: "buyback", burnedAt: new Date(Date.parse("2026-09-10T12:00:00Z") - minAgo * 60000).toISOString() });
// total now 140,000,300; burns newest→oldest: 200 (2 min), 500 (5 min), 900 (9 min). Before the 5-min burn: 139,999,600 < 140M ≤ 140,000,100 → it crossed.
const burns = [b("N", 2, 200), b("M", 5, 500), b("O", 9, 900)];
assert(findCrossing(burns, 140_000_300, S, 14).signature === "M", "the burn that crossed 14% is found");
assert(findCrossing(burns, 140_000_300, S, 13).signature === null, "13% was crossed before the recent window → unknown");
assert(findCrossing(burns, 139_999_000, S, 14).signature === null, "not crossed yet → null");
