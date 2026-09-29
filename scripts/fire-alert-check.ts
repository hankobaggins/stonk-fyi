// Sanity check for the "burns are on fire" tier (§6n): npx tsx scripts/fire-alert-check.ts
import { buildFireText, buildVelocityText, evaluateVelocity, FIRE_RULES, stateFor, supersededByFire } from "../src/lib/velocity-math";
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };
const F = { thresholdPct: 0.5, rearmPct: 0.4, cooldownMin: 240 };
const H = { thresholdPct: 0.3, rearmPct: 0.2, cooldownMin: 240 };
const T0 = "2026-09-29T12:00:00Z";
const min = (m: number) => new Date(Date.parse(T0) + m * 60000).toISOString();

assert(FIRE_RULES.thresholdPct === 0.5 && FIRE_RULES.rearmPct === 0.4 && FIRE_RULES.cooldownMin === 240, "defaults: on fire above 0.5, re-arm below 0.4, 4h cooldown");
assert(stateFor(0.51, F) === "hot" && stateFor(0.5, F) === "cool" && stateFor(0.45, F) === "cool", "state: strictly above 0.5 is on fire");
assert(evaluateVelocity(0.7, null, null, T0, F).action === "seed", "empty ledger while already on fire → seed, never post");
assert(evaluateVelocity(0.45, "cool", null, T0, F).action === "none", "heating but not on fire → nothing on this rail");
const first = evaluateVelocity(0.62, "cool", null, T0, F);
assert(first.action === "hot" && first.announce, "cool → above 0.5 → on fire, announced");
assert(evaluateVelocity(0.42, "hot", T0, min(30), F).action === "none", "on fire, dips to 0.42 → still hot (hysteresis)");
assert(evaluateVelocity(0.39, "hot", T0, min(60), F).action === "cool", "falls below 0.4 → cool row (re-armed)");
const quiet = evaluateVelocity(0.55, "cool", T0, min(120), F);
assert(quiet.action === "hot" && !quiet.announce, "on fire again 2h after the post → quiet");

// Supersede: heating-up flip in the same tick (or within its cooldown) as an on-fire announcement → quiet.
assert(supersededByFire(T0, T0, H), "same tick: heating-up superseded");
assert(supersededByFire(T0, min(239), H) && !supersededByFire(T0, min(240), H), "within the heating-up cooldown only");
assert(!supersededByFire(null, T0, H), "no on-fire post → heating-up posts normally");

const row = { ts: "2026-09-29T17:40:00.000Z", pct_day: 0.62, prev_pct_day: 0.36, prev_ts: "2026-09-29T15:05:00.000Z", window_hours: 4, window_tokens: 24_880_000, window_usd: 3_870_000, window_burns: 67, supply_burned_pct: 15.41 };
const fire = buildFireText(row);
assert(fire.startsWith("$STONK burns are on fire: 0.62% of supply a day over the last 4 hours (") && fire.includes("Up from 0.36%/day 2h 35m ago.") && fire.includes("16% is ~"), "fire tweet text");
assert(buildVelocityText(row).startsWith("$STONK burns are heating up: 0.62%"), "heating-up text unchanged by the refactor");
console.log("\n" + fire);
