// Sanity check for the burn-velocity trigger: npx tsx scripts/velocity-alert-check.ts
import { evaluateVelocity, fmtSince, stateFor } from "../src/lib/velocity-math";
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };
const R = { thresholdPct: 0.3, rearmPct: 0.2, cooldownMin: 240 };
const T0 = "2026-09-13T12:00:00Z";
const min = (m: number) => new Date(Date.parse(T0) + m * 60000).toISOString();

assert(stateFor(0.31, R) === "hot" && stateFor(0.3, R) === "cool" && stateFor(null, R) === "cool", "state: strictly above 0.3 is hot; exactly 0.3, or no burns, is cool");
assert(evaluateVelocity(0.45, null, null, T0, R).action === "seed" && (evaluateVelocity(0.45, null, null, T0, R) as { state: string }).state === "hot", "empty ledger while already hot → seed hot, never post");
assert(evaluateVelocity(0.1, null, null, T0, R).action === "seed", "empty ledger while cool → seed cool");
assert(evaluateVelocity(0.25, "cool", null, T0, R).action === "none", "cool and below the line → nothing");
const first = evaluateVelocity(0.34, "cool", null, T0, R);
assert(first.action === "hot" && first.announce, "cool → above 0.3 with no prior post → hot, announced");
assert(evaluateVelocity(0.29, "hot", T0, min(10), R).action === "none", "hot, dips to 0.29 → still hot (hysteresis: no cool row, no re-post on the next 0.31)");
assert(evaluateVelocity(0.31, "hot", T0, min(20), R).action === "none", "hot and still above → nothing (no repeat post)");
assert(evaluateVelocity(0.19, "hot", T0, min(30), R).action === "cool", "hot, falls below 0.2 → cool row (re-armed)");
const quiet = evaluateVelocity(0.35, "cool", T0, min(90), R);
assert(quiet.action === "hot" && !quiet.announce, "re-armed and hot again 90 min after the post → recorded quiet, not posted");
const again = evaluateVelocity(0.35, "cool", T0, min(240), R);
assert(again.action === "hot" && again.announce, "hot again 4h after the last post → posted");
assert(evaluateVelocity(null, "hot", T0, min(300), R).action === "cool", "no burns at all in the window while hot → cool");
assert(fmtSince(T0, min(45)) === "45m" && fmtSince(T0, min(200)) === "3h 20m" && fmtSince(T0, min(180)) === "3h" && fmtSince(T0, min(3 * 1440)) === "3.0 days", "fmtSince phrasing");
