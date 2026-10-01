// Sanity check for the wallet rewards check (§6o): npx tsx scripts/wallet-rewards-check.ts
import { addPayouts, buildView, classifyTx, distKey, emptyAgg, isWalletAddress, noteUnexplained, payoutsIn, plainTransferSource, toAmount, type RawTx } from "../src/lib/wallet-rewards-math";
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };

const HUBME = "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga";
const OPS = "5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD";
const PAYER = "8msbtwpuengAMp1WSgZwFYB97itbxMfMqaCv6ukzudEj";
const W = "57XeGcavnQ7mL9kWdzrVABLhexS2VfCsDZmdGPs5xiG7";
const OTHER = "4d3RAhy1KWP2XebC1w6U2gR6PX63RgDEXARa7Yvo5dLX";
const FEEWALLET = "4EjLEerv4zEuKbZ4DXoCN7bnxWhqLNvUVoz89DX5FfP5";
const GOLD = "GoLDppdjB1vDTPSGxyMJFqdnj134yH6Prg9eqsGDiw6A";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const CB = "ComputeBudget111111111111111111111111111111";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const CLMM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
const D = new Set([HUBME, OPS]);

type Bal = [number, string, string, string?]; // accountIndex, owner, amount, mint
// accountKeys: signers…, then ataW(+0), ataO(+1), vault(+2), then programs. Encoding "json": string keys + programIdIndex.
const tx = (o: Partial<{ slot: number; t: number; signers: string[]; pre: Bal[]; post: Bal[]; err: unknown; sig: string; programs: string[]; inner: string[]; loaded: string[] }> = {}): RawTx => {
  const signers = o.signers ?? [PAYER, HUBME];
  const progs = o.programs ?? [CB, TOKEN];
  const keys = [...signers, "ataW", "ataO", "vault", ...progs];
  const loaded = o.loaded ?? [];
  const all = [...keys, ...loaded];
  const s = signers.length;
  const bal = (b: Bal) => ({ accountIndex: b[0] + s, mint: b[3] ?? GOLD, owner: b[1], uiTokenAmount: { amount: b[2], decimals: 6 } });
  return {
    slot: o.slot ?? 100,
    blockTime: o.t ?? Date.parse("2026-10-01T16:39:26Z") / 1000,
    transaction: { signatures: [o.sig ?? "sigA"], message: { accountKeys: keys, header: { numRequiredSignatures: s }, instructions: progs.map((p) => ({ programIdIndex: all.indexOf(p) })) } },
    meta: {
      err: o.err ?? null,
      loadedAddresses: { writable: [], readonly: loaded },
      innerInstructions: o.inner ? [{ instructions: o.inner.map((p) => ({ programIdIndex: all.indexOf(p) })) }] : [],
      preTokenBalances: (o.pre ?? [[0, W, "100"], [1, OTHER, "5"], [2, HUBME, "10000"]]).map(bal),
      postTokenBalances: (o.post ?? [[0, W, "955"], [1, OTHER, "50"], [2, HUBME, "9100"]]).map(bal),
    },
  };
};

// The live shape (2026-10-01, HuBMe) and the pre-2026-09-20 shape (5KXDF6 signs alone, pays from its own account).
const p = payoutsIn(tx(), W, D);
assert(p.length === 1 && p[0].mint === GOLD && p[0].raw === BigInt(855) && p[0].by === HUBME, "HuBMe batch → one payout, the increase, attributed to HuBMe");
const old = payoutsIn(tx({ signers: [OPS], programs: [TOKEN, ATA], pre: [[1, OTHER, "5"], [2, OPS, "10000"]], post: [[0, W, "300"], [1, OTHER, "50"], [2, OPS, "9655"]] }), W, D);
assert(old.length === 1 && old[0].raw === BigInt(300) && old[0].by === OPS, "5KXDF6 batch before Sep 20 (account created in the tx) → payout by 5KXDF6");
assert(payoutsIn(tx({ programs: [TOKEN], loaded: ["lut1"] }), W, D).length === 1, "v0 transaction with lookup-table addresses → still read");

// Not payouts.
assert(payoutsIn(tx({ signers: [PAYER, "SomeoneElse111111111111111111111111111111111"], pre: [[0, W, "100"], [1, OTHER, "5"], [2, "SomeoneElse111111111111111111111111111111111", "10000"]], post: [[0, W, "955"], [1, OTHER, "50"], [2, "SomeoneElse111111111111111111111111111111111", "9100"]] }), W, D).length === 0, "plain transfer from a non-distributor → not a payout");
const friend = classifyTx(tx({ signers: [OTHER], pre: [[0, W, "100"], [1, OTHER, "500"]], post: [[0, W, "200"], [1, OTHER, "400"]] }), W, D);
assert(friend.kind === "unexplained" && friend.source === OTHER, "…and noted as unexplained, by source");
assert(classifyTx(tx({ signers: [W, HUBME] }), W, D).kind === "own", "wallet signed it → its own transaction");
assert(payoutsIn(tx({ err: { InstructionError: [0, "x"] } }), W, D).length === 0, "failed transaction → nothing");
assert(classifyTx(tx({ post: [[0, W, "50"], [1, OTHER, "50"], [2, HUBME, "9100"]] }), W, D).kind === "no-increase", "balance fell → nothing");
// 5KXDF6 swapping: another program in the tx, two mints moving — a pool account's balance rises but it is not a payout.
const swap = tx({ signers: [OPS], programs: [CB, CLMM], inner: [TOKEN, TOKEN], pre: [[0, W, "100"], [2, OPS, "10000"], [1, OPS, "0", USDC]], post: [[0, W, "955"], [2, OPS, "9145"], [1, OPS, "70", USDC]] });
assert(payoutsIn(swap, W, D).length === 0 && plainTransferSource(swap) === null, "distributor swap (DEX program, two mints) → not a payout");
const swapInner = tx({ signers: [OPS], programs: [CB, TOKEN], inner: [CLMM], pre: [[0, W, "100"], [2, OPS, "10000"]], post: [[0, W, "955"], [2, OPS, "9145"]] });
assert(payoutsIn(swapInner, W, D).length === 0, "a DEX program only as an inner instruction still disqualifies");
// 5KXDF6 funding HuBMe and paying the operating fee in the same tx (seen 2026-10-01 17:29, NVDAX).
const funding = tx({ signers: [OPS], programs: [CB, ATA, TOKEN], pre: [[0, FEEWALLET, "100"], [1, HUBME, "0"], [2, OPS, "94124598"]], post: [[0, FEEWALLET, "3293059"], [1, HUBME, "90831639"], [2, OPS, "0"]] });
assert(payoutsIn(funding, FEEWALLET, D).length === 0 && classifyTx(funding, FEEWALLET, D).kind === "unexplained", "internal funding (a distributor's balance rises) → not a payout for anyone in it");
assert(payoutsIn(tx(), HUBME, D).length === 0, "a distributor looked up as a wallet → never its own payouts");
assert(payoutsIn(tx({ pre: [[0, W, "100"], [1, OTHER, "5"], [2, HUBME, "10000"], [3, HUBME, "0", USDC]], post: [[0, W, "955"], [1, OTHER, "50"], [2, HUBME, "9100"], [3, HUBME, "1", USDC]] }), W, D).length === 0, "two mints moving → not a payout");

// Aggregate + view.
const agg = emptyAgg(W);
const solTx = tx({ sig: "sigS", pre: [[0, W, "0", "So11111111111111111111111111111111111111112"], [2, HUBME, "5000000", "So11111111111111111111111111111111111111112"]], post: [[0, W, "1000000", "So11111111111111111111111111111111111111112"], [2, HUBME, "4000000", "So11111111111111111111111111111111111111112"]] });
solTx.meta!.preTokenBalances!.forEach((b) => (b.uiTokenAmount.decimals = 9));
solTx.meta!.postTokenBalances!.forEach((b) => (b.uiTokenAmount.decimals = 9));
const ps = payoutsIn(solTx, W, D);
assert(ps.length === 1 && ps[0].raw === BigInt(1_000_000) && ps[0].decimals === 9, "SOL payouts arrive as wrapped SOL (token transfer) and count");
addPayouts(agg, [...payoutsIn(tx({ sig: "s1", t: Date.parse("2026-09-25T10:00:00Z") / 1000 }), W, D), ...payoutsIn(tx({ sig: "s2" }), W, D), ...ps]);
assert(agg.payouts === 3 && agg.assets[GOLD].payouts === 2 && agg.assets[GOLD].raw === "1710", "aggregate: 3 payout txs, GOLD twice, raw summed as a string (no float drift)");
assert(agg.byDistributor[HUBME] === 3, "payouts counted by distributor");
assert(agg.firstAt === "2026-09-25T10:00:00.000Z" && agg.recent[0].sig !== "s1", "first payout date; recent list newest first");
for (let i = 0; i < 30; i++) noteUnexplained(agg, `src${i}`);
noteUnexplained(agg, "src29");
assert(Object.keys(agg.unexplained).length === 20 && agg.unexplained.src29 === 2, "unexplained sources capped at 20, most frequent kept");
assert(toAmount("123456789", 6) === 123.456789 && toAmount(BigInt("1000000000000000000000"), 9) === 1e12, "toAmount: exact for raw beyond 2^53");
agg.coins = [{ mint: "COIN", quote: GOLD, symbol: "GILD" }];
const SOL = "So11111111111111111111111111111111111111112";
const v = buildView(agg, { [GOLD]: 4000, [SOL]: 150 }, { [GOLD]: "GOLD" }, "2026-10-01T17:00:00Z");
assert(Math.abs(v.totalUsd - (0.00171 * 4000 + 0.001 * 150)) < 1e-9, "total at today's prices");
assert(v.assets[0].symbol === "GOLD" && v.assets[0].from[0] === "GILD" && v.assets[1].symbol === "SOL", "assets ranked by USD; source coin inferred from held coins quoted in that asset");
assert(v.series.length === 7 && Math.abs(v.series[v.series.length - 1].usd - v.totalUsd) < 1e-9, "cumulative daily series ends at the total");
assert(v.last7dUsd !== null && Math.abs(v.last7dUsd - v.totalUsd) < 1e-9, "last 7 days covers Sep 25 – Oct 1");
assert(buildView(agg, { [GOLD]: 4000 }, {}, "2026-10-01T17:00:00Z").pricedShare < 1, "unpriced asset → priced share < 1");
assert(distKey([HUBME, OPS]) === distKey([OPS, HUBME]) && distKey([HUBME]) !== distKey([HUBME, OPS]), "distKey: order-free, changes with the set");
assert(isWalletAddress(W) && !isWalletAddress("0OIl") && !isWalletAddress(W + "x".repeat(5)), "address validation");
console.log("all wallet rewards checks passed");
