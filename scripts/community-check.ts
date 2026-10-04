// Sanity check for the Community Mode split (§6p): npx tsx scripts/community-check.ts
import { dailySeries, inferDecimals, splitRaw, toTokens, transitionFor } from "../src/lib/community-math";
import { buildView, emptyAgg } from "../src/lib/wallet-rewards-math";
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };
const B = (n: number | string) => BigInt(n);

// Launched in the mode: the whole total is split 33 / 67.
const a = splitRaw(B(10_000), [{ shareBps: 3300, startRaw: B(0), endRaw: null }]);
assert(a.toQuoteRaw === B(3300) && a.toCoinRaw === B(6700) && a.plainRaw === B(0), "launched in the mode: 33% to quote holders, 67% to coin holders, nothing plain");

// Switched in at 4,000: only what came after is split.
const b = splitRaw(B(10_000), [{ shareBps: 3300, startRaw: B(4000), endRaw: null }]);
assert(b.communityRaw === B(6000) && b.toQuoteRaw === B(1980) && b.plainRaw === B(4000), "switched in at 4,000 of 10,000: 6,000 split (1,980 to quote holders), 4,000 plain");

// Switched in, out, and in again at a new share.
const c = splitRaw(B(10_000), [
  { shareBps: 3300, startRaw: B(1000), endRaw: B(3000) },
  { shareBps: 5000, startRaw: B(6000), endRaw: null },
]);
assert(c.communityRaw === B(6000) && c.toQuoteRaw === B(660 + 2000) && c.plainRaw === B(4000), "two periods (33% then 50%): each counts its own stretch, the gap is plain");

// A stale upstream total below a period's start never gives a negative leg.
const d = splitRaw(B(900), [{ shareBps: 3300, startRaw: B(1000), endRaw: null }]);
assert(d.communityRaw === B(0) && d.toQuoteRaw === B(0) && d.plainRaw === B(900), "total below the period start → nothing split, nothing negative");

// Base units beyond 2^53 stay exact.
const big = splitRaw(B("308783243880884000"), [{ shareBps: 3300, startRaw: B(0), endRaw: null }]);
assert(big.toQuoteRaw === B("101898470480691720") && big.toQuoteRaw + big.toCoinRaw === B("308783243880884000"), "BigInt: legs add back to the total past 2^53");
assert(Math.abs(toTokens(B("9536277937"), 6) - 9536.277937) < 1e-9, "toTokens: 9,536,277,937 at 6 decimals");
assert(inferDecimals("9536277937", 9536.277937) === 6 && inferDecimals(undefined, 3) === null, "inferDecimals from raw / whole");

// Transitions.
const NEW = "2026-10-03T12:00:00Z", OLD = "2026-09-01T00:00:00Z";
const cm = { shareBps: 3300 };
assert(transitionFor(cm, null, { createdAt: NEW, launchedAs: "community", hadPeriod: false })?.kind === "open", "community, no open period → open");
assert((transitionFor(cm, null, { createdAt: NEW, launchedAs: "community", hadPeriod: false }) as { startKind: string }).startKind === "launch", "recorded as launched in the mode → launch (split from 0)");
assert((transitionFor(cm, null, { createdAt: NEW, launchedAs: "plain", hadPeriod: false }) as { startKind: string }).startKind === "switch", "recorded as a plain launch, now community → switch");
assert((transitionFor(cm, null, { createdAt: OLD, launchedAs: null, hadPeriod: false }) as { startKind: string }).startKind === "switch", "created before the mode existed → switch");
assert((transitionFor(cm, null, { createdAt: NEW, launchedAs: null, hadPeriod: false }) as { startKind: string }).startKind === "launch", "created after go-live, launch never recorded (seed / race) → launch");
assert((transitionFor(cm, null, { createdAt: NEW, launchedAs: "community", hadPeriod: true }) as { startKind: string }).startKind === "switch", "back in the mode after leaving it → switch");
assert(transitionFor(null, { shareBps: 3300 }, { createdAt: NEW, launchedAs: "community", hadPeriod: false })?.kind === "close", "plain now with an open period → close");
assert(transitionFor({ shareBps: 5000 }, { shareBps: 3300 }, { createdAt: NEW, launchedAs: "community", hadPeriod: false })?.kind === "rate", "share changed → rate (close + reopen)");
assert(transitionFor(cm, { shareBps: 3300 }, { createdAt: NEW, launchedAs: "community", hadPeriod: false }) === null, "same mode, same share → nothing");
assert(transitionFor(null, null, { createdAt: NEW, launchedAs: "plain", hadPeriod: false }) === null, "plain and never in the mode → nothing");
assert(transitionFor({ shareBps: 0 }, null, { createdAt: NEW, launchedAs: null, hadPeriod: false }) === null, "shareBps 0 counts as plain");

// Daily series.
const rows = [
  { day: "2026-10-02", quoteMint: "Q", toQuoteTokens: 10 },
  { day: "2026-10-03", quoteMint: "Q", toQuoteTokens: 25 },
  { day: "2026-10-03", quoteMint: "R", toQuoteTokens: 100 },
  { day: "2026-10-04", quoteMint: "R", toQuoteTokens: 140 },
];
const s = dailySeries(rows, { Q: 2, R: 1 }, "2026-10-02");
assert(s.length === 3 && s[0].value === 20 && s[1].value === 30 && s[2].value === 40, "daily: first-day readings count from 0, later starts are skipped, per-quote deltas × price summed per day");

// Wallet check attribution (§6p).
const U = "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk";
const w = emptyAgg("W");
w.assets[U] = { raw: "3000000", decimals: 6, payouts: 3, first: "2026-09-30T00:00:00Z", last: "2026-10-03T12:00:00Z", symbol: "USELESS" };
w.days = { "2026-09-30": { [U]: "1000000" }, "2026-10-03": { [U]: "2000000" } };
const cq = { [U]: { since: "2026-10-02T22:06:18Z", coins: 201 } };
let v = buildView(w, { [U]: 0.25 }, {}, "2026-10-04T00:00:00Z", cq);
assert(v.groups.length === 1 && v.groups[0].kind === "community" && v.groups[0].amount === 2 && v.groups[0].payouts === null, "wallet: no held coin pays in it → community card, counted only since community coins began paying it (2 of 3), payout count unknown");
assert(v.assets[0].from.includes("community coins"), "wallet: receipt names community coins as a source");
w.coins = [{ mint: "C1", quote: U, symbol: "GILD" }];
v = buildView(w, { [U]: 0.25 }, {}, "2026-10-04T00:00:00Z", cq);
assert(v.groups[0].kind === "coin" && v.assets[0].from.join() === "GILD", "wallet: holds a coin paying in it but not the asset → plain coin card");
w.quotesHeld = [U];
v = buildView(w, { [U]: 0.25 }, {}, "2026-10-04T00:00:00Z", cq);
assert(v.groups[0].kind === "mixed" && v.groups[0].amount === 3, "wallet: holds the coin and the asset → mixed card, whole amount, not split");
assert(buildView(w, { [U]: 0.25 }, {}, "2026-10-04T00:00:00Z", {}).groups[0].kind === "coin", "wallet: no community coins in the asset → unchanged");
console.log("all community checks passed");
