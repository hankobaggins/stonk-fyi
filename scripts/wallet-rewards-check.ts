// Sanity check for the wallet rewards check (§6o): npx tsx scripts/wallet-rewards-check.ts
import { addPayouts, buildView, emptyAgg, isWalletAddress, payoutsIn, SOL_MINT, toAmount, type RawTx } from "../src/lib/wallet-rewards-math";
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };

const DIST = "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga";
const PAYER = "8msbtwpuengAMp1WSgZwFYB97itbxMfMqaCv6ukzudEj";
const W = "57XeGcavnQ7mL9kWdzrVABLhexS2VfCsDZmdGPs5xiG7";
const OTHER = "4d3RAhy1KWP2XebC1w6U2gR6PX63RgDEXARa7Yvo5dLX";
const GOLD = "GoLDppdjB1vDTPSGxyMJFqdnj134yH6Prg9eqsGDiw6A";
const D = new Set([DIST]);

// Shaped like the live distribution 52FSJK… (2026-10-01): payer + distributor sign; transferChecked from the
// distributor's GOLD account into holders' token accounts; the wallet itself is not in the account list.
const tx = (o: Partial<{ slot: number; t: number; signers: string[]; pre: [number, string, string][]; post: [number, string, string][]; err: unknown; sig: string }> = {}): RawTx => {
  const signers = o.signers ?? [PAYER, DIST];
  return {
    slot: o.slot ?? 100,
    blockTime: o.t ?? Date.parse("2026-10-01T16:39:26Z") / 1000,
    transaction: { signatures: [o.sig ?? "sigA"], message: { accountKeys: [...signers, "ataW", "ataO", "vault"], header: { numRequiredSignatures: signers.length } } },
    meta: {
      err: o.err ?? null,
      preTokenBalances: (o.pre ?? [[2, W, "100"], [3, OTHER, "5"], [4, DIST, "10000"]]).map(([i, owner, amount]) => ({ accountIndex: i, mint: GOLD, owner, uiTokenAmount: { amount, decimals: 6 } })),
      postTokenBalances: (o.post ?? [[2, W, "955"], [3, OTHER, "50"], [4, DIST, "9100"]]).map(([i, owner, amount]) => ({ accountIndex: i, mint: GOLD, owner, uiTokenAmount: { amount, decimals: 6 } })),
    },
  };
};

const p = payoutsIn(tx(), W, D);
assert(p.length === 1 && p[0].mint === GOLD && p[0].raw === BigInt(855) && p[0].decimals === 6, "distributor-signed transfer in → one payout, the balance increase (855 raw)");
assert(payoutsIn(tx({ pre: [[3, OTHER, "5"], [4, DIST, "10000"]] }), W, D)[0].raw === BigInt(955), "token account created in the payout tx → whole post balance");
assert(payoutsIn(tx({ signers: [PAYER, "SomeoneElse111111111111111111111111111111111"] }), W, D).length === 0, "not signed by a distributor → not a payout (a trade, a transfer from a friend)");
assert(payoutsIn(tx({ signers: [W, DIST] }), W, D).length === 0, "wallet signed it → its own transaction, not a payout");
assert(payoutsIn(tx({ err: { InstructionError: [0, "x"] } }), W, D).length === 0, "failed transaction → nothing");
assert(payoutsIn(tx({ post: [[2, W, "50"], [3, OTHER, "50"], [4, DIST, "9100"]] }), W, D).length === 0, "balance fell → nothing");
assert(payoutsIn(tx(), OTHER, D)[0].raw === BigInt(45), "same tx, another holder → its own amount");

// Native SOL: the wallet's lamports rose in a distributor-signed tx it did not sign.
const sol: RawTx = { ...tx(), transaction: { signatures: ["sigS"], message: { accountKeys: [PAYER, DIST, W], header: { numRequiredSignatures: 2 } } }, meta: { err: null, preBalances: [5e9, 9e9, 1_000_000], postBalances: [5e9, 8e9, 2_000_000], preTokenBalances: [], postTokenBalances: [] } };
const ps = payoutsIn(sol, W, D);
assert(ps.length === 1 && ps[0].mint === SOL_MINT && ps[0].raw === BigInt(1_000_000), "native SOL payout counted (lamport increase)");

// jsonParsed-style keys ({pubkey, signer}) work the same.
const parsed = tx();
parsed.transaction.message.accountKeys = [{ pubkey: PAYER, signer: true }, { pubkey: DIST, signer: true }, { pubkey: "ataW" }, { pubkey: "ataO" }, { pubkey: "vault" }];
delete parsed.transaction.message.header;
assert(payoutsIn(parsed, W, D).length === 1, "jsonParsed account keys");

// Aggregate + view.
const agg = emptyAgg(W);
addPayouts(agg, [...payoutsIn(tx({ sig: "s1", t: Date.parse("2026-09-25T10:00:00Z") / 1000 }), W, D), ...payoutsIn(tx({ sig: "s2" }), W, D), ...ps]);
assert(agg.payouts === 3 && agg.assets[GOLD].payouts === 2 && agg.assets[GOLD].raw === "1710", "aggregate: 3 payout txs, GOLD twice, raw summed as a string (no float drift)");
assert(agg.firstAt === "2026-09-25T10:00:00.000Z" && agg.recent[0].sig !== "s1", "first payout date; recent list newest first");
assert(toAmount("123456789", 6) === 123.456789 && toAmount(BigInt("1000000000000000000000"), 9) === 1e12, "toAmount: exact for raw beyond 2^53");
agg.coins = [{ mint: "COIN", quote: GOLD, symbol: "GILD" }];
const v = buildView(agg, { [GOLD]: 4000, [SOL_MINT]: 150 }, { [GOLD]: "GOLD" }, "2026-10-01T17:00:00Z");
assert(Math.abs(v.totalUsd - (0.00171 * 4000 + 0.001 * 150)) < 1e-9, "total at today's prices");
assert(v.assets[0].symbol === "GOLD" && v.assets[0].from[0] === "GILD" && v.assets[1].symbol === "SOL", "assets ranked by USD; source coin inferred from held coins quoted in that asset");
assert(v.series.length === 7 && v.series[0].usd < v.series[v.series.length - 1].usd && Math.abs(v.series[v.series.length - 1].usd - v.totalUsd) < 1e-9, "cumulative daily series, Sep 25 → Oct 1, ends at the total");
assert(v.last7dUsd !== null && Math.abs(v.last7dUsd - v.totalUsd) < 1e-9, "last 7 days covers Sep 25 – Oct 1");
const unpriced = buildView(agg, { [GOLD]: 4000 }, {}, "2026-10-01T17:00:00Z");
assert(unpriced.assets.find((a) => a.mint === SOL_MINT)?.usd === null && unpriced.pricedShare < 1, "unpriced asset → usd null, priced share < 1");
assert(isWalletAddress(W) && !isWalletAddress("0OIl") && !isWalletAddress(W + "x".repeat(5)), "address validation");
assert(buildView(emptyAgg(W), {}, {}, "2026-10-01T17:00:00Z").series.length === 0, "never paid → empty series");
console.log("all wallet rewards checks passed");
