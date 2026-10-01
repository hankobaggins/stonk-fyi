// Pure core of the wallet rewards check (§6o): classify one wallet's transactions as reward payouts, fold them into
// the stored aggregate, and turn the aggregate into what the page and the cards show. No I/O here, so
// scripts/wallet-rewards-check.ts can exercise it offline.
//
// What a payout looks like on-chain (verified 2026-10-01 on live distributions and on holders' histories back to the
// first reward launches, 2026-08-03): a distributor wallet signs a transaction that only moves ONE token — plain
// `transfer` / `transferChecked` from the distributor's own token account for the payout asset into holders' token
// accounts (created with `createIdempotent` when missing), plus compute-budget instructions; a rotating fee payer may
// co-sign. The coin that earned the payout is not in the transaction — only the asset paid.
//
// Distributors so far: 5KXDF6… (StonkFun's operations wallet) paid holders directly until 2026-09-20 05:03 UTC;
// from then HuBMe… pays, funded by 5KXDF6 (first funding tx 05:02:45, first payout 05:03:44). 5KXDF6 also swaps,
// sweeps transfer fees and funds HuBMe, so "signed by a distributor" alone is not enough: a payout must also be a
// plain single-asset transfer out of a distributor's account (classifyTx), which rules out swaps (other programs,
// two mints), fee sweeps, and internal funding (a distributor's balance goes up).

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const RECENT_KEEP = 25;
export const UNEXPLAINED_KEEP = 20;
// Bump when the classification rule changes: stored wallets scanned under another rule (or another distributor set)
// are re-read from the start on their next lookup.
export const RULES_VERSION = 2;
export const distKey = (distributors: Iterable<string>) => `v${RULES_VERSION}:${[...distributors].sort().join(",")}`;

export const isWalletAddress = (s: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

// Programs a payout transaction may invoke (top level or inner). Anything else — a DEX, an aggregator, a launchpad
// program — means the transaction is not a plain payout.
export const PLAIN_PROGRAMS: ReadonlySet<string> = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Account
  "11111111111111111111111111111111", // System (account creation inside createIdempotent)
  "ComputeBudget111111111111111111111111111111",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);

// The parts of a getTransaction-shaped result (encoding "json" or "jsonParsed", versions legacy / 0 / 1) this needs.
type Key = string | { pubkey: string; signer?: boolean };
type Ix = { programIdIndex?: number; programId?: string };
type TokenBal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };
export type RawTx = {
  slot: number;
  blockTime?: number | null;
  transaction: { signatures: string[]; message: { accountKeys: Key[]; header?: { numRequiredSignatures: number }; instructions?: Ix[] } };
  meta: {
    err?: unknown;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: TokenBal[];
    postTokenBalances?: TokenBal[];
    innerInstructions?: { instructions: Ix[] }[] | null;
    loadedAddresses?: { writable?: string[]; readonly?: string[] } | null;
  } | null;
};

export type Payout = { sig: string; slot: number; ts: string; mint: string; raw: bigint; decimals: number; by: string };

function signersOf(tx: RawTx): string[] {
  const keys = tx.transaction.message.accountKeys;
  const n = tx.transaction.message.header?.numRequiredSignatures;
  const out: string[] = [];
  keys.forEach((k, i) => {
    if (typeof k === "string") {
      if (n !== undefined && i < n) out.push(k);
    } else if (k.signer) out.push(k.pubkey);
  });
  return out;
}
// Static keys, then the lookup-table addresses (writable, readonly) — the order instruction indexes use.
function allKeys(tx: RawTx): string[] {
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const la = tx.meta?.loadedAddresses;
  return la ? [...keys, ...(la.writable ?? []), ...(la.readonly ?? [])] : keys;
}
function programsOf(tx: RawTx): string[] {
  const keys = allKeys(tx);
  const ixs = [...(tx.transaction.message.instructions ?? []), ...(tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions ?? [])];
  return [...new Set(ixs.map((i) => i.programId ?? (i.programIdIndex !== undefined ? keys[i.programIdIndex] : "?")))];
}

type Change = { owner: string; mint: string; delta: bigint; decimals: number };
function balanceChanges(tx: RawTx): Change[] {
  const pre = new Map<number, TokenBal>();
  for (const b of tx.meta?.preTokenBalances ?? []) pre.set(b.accountIndex, b);
  const seen = new Set<number>();
  const out: Change[] = [];
  for (const b of tx.meta?.postTokenBalances ?? []) {
    seen.add(b.accountIndex);
    const d = BigInt(b.uiTokenAmount.amount) - BigInt(pre.get(b.accountIndex)?.uiTokenAmount.amount ?? "0");
    if (d !== BigInt(0)) out.push({ owner: b.owner ?? "?", mint: b.mint, delta: d, decimals: b.uiTokenAmount.decimals });
  }
  // An account closed in the transaction has a pre balance and no post balance.
  for (const [i, b] of pre) if (!seen.has(i) && BigInt(b.uiTokenAmount.amount) !== BigInt(0)) out.push({ owner: b.owner ?? "?", mint: b.mint, delta: -BigInt(b.uiTokenAmount.amount), decimals: b.uiTokenAmount.decimals });
  return out;
}

// The shape of a distribution: plain programs only, one mint moving, every decrease from one owner, every other
// change an increase. Returns that owner (the payer of the batch) or null. Used both to classify a wallet's
// transactions and to learn the distributor from StonkFun's own distribution signatures.
export function plainTransferSource(tx: RawTx): { source: string; mint: string; changes: Change[] } | null {
  if (!tx.meta || tx.meta.err) return null;
  if (programsOf(tx).some((p) => !PLAIN_PROGRAMS.has(p))) return null;
  const changes = balanceChanges(tx);
  if (!changes.length) return null;
  const mints = new Set(changes.map((c) => c.mint));
  if (mints.size !== 1) return null;
  const down = new Set(changes.filter((c) => c.delta < BigInt(0)).map((c) => c.owner));
  if (down.size !== 1) return null;
  const [source] = [...down];
  if (changes.some((c) => c.owner === source && c.delta > BigInt(0))) return null;
  return { source, mint: [...mints][0], changes };
}

export type TxClass =
  | { kind: "payout"; payouts: Payout[] }
  | { kind: "own" }                      // the wallet signed it: its own trade / transfer
  | { kind: "no-increase" }              // nothing of the wallet's went up
  | { kind: "unexplained"; source: string | null }; // something went up, but not a distributor payout

// Classifies one transaction from `wallet`'s history.
export function classifyTx(tx: RawTx, wallet: string, distributors: ReadonlySet<string>): TxClass {
  if (!tx.meta || tx.meta.err) return { kind: "no-increase" };
  const signers = signersOf(tx);
  if (signers.includes(wallet)) return { kind: "own" };
  const mine = balanceChanges(tx).filter((c) => c.owner === wallet && c.delta > BigInt(0));
  if (!mine.length) return { kind: "no-increase" };
  const plain = plainTransferSource(tx);
  if (!plain) return { kind: "unexplained", source: null };
  const isDistributor = distributors.has(plain.source) && signers.includes(plain.source);
  // Internal funding (a distributor topping up another) never counts, for any recipient.
  const funding = plain.changes.some((c) => c.delta > BigInt(0) && distributors.has(c.owner));
  if (!isDistributor || funding || distributors.has(wallet)) return { kind: "unexplained", source: plain.source };
  const sig = tx.transaction.signatures[0];
  const ts = new Date((tx.blockTime ?? 0) * 1000).toISOString();
  let raw = BigInt(0);
  for (const c of mine) raw += c.delta;
  return { kind: "payout", payouts: [{ sig, slot: tx.slot, ts, mint: plain.mint, raw, decimals: mine[0].decimals, by: plain.source }] };
}

export function payoutsIn(tx: RawTx, wallet: string, distributors: ReadonlySet<string>): Payout[] {
  const c = classifyTx(tx, wallet, distributors);
  return c.kind === "payout" ? c.payouts : [];
}

// ---- The stored aggregate (one wallet_rewards row) ----

export type AssetAgg = { raw: string; decimals: number; payouts: number; first: string; last: string; symbol?: string };
export type RecentPayout = { sig: string; ts: string; mint: string; raw: string; decimals: number };
export type HeldCoin = { mint: string; quote: string; symbol?: string; quoteSymbol?: string; lastPayoutAt?: string };
export type WalletAgg = {
  wallet: string;
  scannedAt: string | null;
  complete: boolean;
  lastSlot: number | null;
  cursor: string | null;
  passFrom: number | null;
  txsScanned: number;
  credits: number;
  payouts: number;       // payout transactions (one tx paying two assets counts once)
  firstAt: string | null;
  lastAt: string | null;
  assets: Record<string, AssetAgg>;
  days: Record<string, Record<string, string>>;
  recent: RecentPayout[];
  coins: HeldCoin[];
  error: string | null;
  distKey: string | null;                       // distKey() of the distributor set + rules this aggregate was built with
  unexplained: Record<string, number>;          // plain transfers into the wallet from non-distributors, by source (top 20)
  byDistributor: Record<string, number>;        // payout txs by the distributor that sent them
};

export const emptyAgg = (wallet: string): WalletAgg => ({
  wallet, scannedAt: null, complete: false, lastSlot: null, cursor: null, passFrom: null, txsScanned: 0, credits: 0,
  payouts: 0, firstAt: null, lastAt: null, assets: {}, days: {}, recent: [], coins: [], error: null, distKey: null, unexplained: {}, byDistributor: {},
});

// Notes a non-payout increase from a plain transfer (a friend, an airdrop — or a distributor this site does not know
// yet: /api/health sums these across stored wallets to spot one).
export function noteUnexplained(agg: WalletAgg, source: string | null): void {
  if (!source) return;
  agg.unexplained[source] = (agg.unexplained[source] ?? 0) + 1;
  // Over the cap, drop the least frequent other source (never the one just counted, or a newcomer could never build up).
  const keys = Object.keys(agg.unexplained).filter((k) => k !== source);
  if (keys.length >= UNEXPLAINED_KEEP) {
    const drop = keys.reduce((lo, k) => (agg.unexplained[k] < agg.unexplained[lo] ? k : lo), keys[0]);
    delete agg.unexplained[drop];
  }
}

// Folds one page of payouts into the aggregate (mutates and returns it). Callers never feed the same transaction
// twice: passes are slot-ordered and resume from Helius's own cursor.
export function addPayouts(agg: WalletAgg, payouts: Payout[]): WalletAgg {
  const txs = new Set<string>();
  for (const p of payouts) {
    txs.add(p.sig);
    const a = agg.assets[p.mint] ?? { raw: "0", decimals: p.decimals, payouts: 0, first: p.ts, last: p.ts };
    a.raw = (BigInt(a.raw) + p.raw).toString();
    a.payouts += 1;
    if (p.ts < a.first) a.first = p.ts;
    if (p.ts > a.last) a.last = p.ts;
    agg.assets[p.mint] = a;
    const d = p.ts.slice(0, 10);
    const day = (agg.days[d] ??= {});
    day[p.mint] = (BigInt(day[p.mint] ?? "0") + p.raw).toString();
    if (!agg.firstAt || p.ts < agg.firstAt) agg.firstAt = p.ts;
    if (!agg.lastAt || p.ts > agg.lastAt) agg.lastAt = p.ts;
    agg.recent.push({ sig: p.sig, ts: p.ts, mint: p.mint, raw: p.raw.toString(), decimals: p.decimals });
  }
  agg.payouts += txs.size;
  const byTx = new Map(payouts.map((p) => [p.sig, p.by]));
  for (const by of byTx.values()) agg.byDistributor[by] = (agg.byDistributor[by] ?? 0) + 1;
  agg.recent.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
  agg.recent = agg.recent.slice(0, RECENT_KEEP);
  return agg;
}

// ---- What the page and the cards show ----

export const toAmount = (raw: string | bigint, decimals: number): number => {
  const r = typeof raw === "bigint" ? raw : BigInt(raw);
  const base = BigInt(10) ** BigInt(decimals);
  return Number(r / base) + Number(r % base) / Number(base);
};

export type AssetView = { mint: string; symbol: string; amount: number; usd: number | null; payouts: number; first: string; last: string; from: string[] };
export type WalletView = {
  wallet: string;
  scannedAt: string | null;
  complete: boolean;
  payouts: number;
  txsScanned: number;
  firstAt: string | null;
  lastAt: string | null;
  totalUsd: number;
  last7dUsd: number | null;
  pricedShare: number;          // share of payouts whose asset has a price
  assets: AssetView[];
  series: { t: string; usd: number }[];
  recent: (RecentPayout & { symbol: string; amount: number })[];
  coins: HeldCoin[];
  error: string | null;
};

// `prices` = USD per whole token now; `symbols` = mint → ticker (stored symbols win). `now` is passed in (purity).
export function buildView(agg: WalletAgg, prices: Record<string, number>, symbols: Record<string, string>, now: string): WalletView {
  const sym = (m: string) => agg.assets[m]?.symbol ?? symbols[m] ?? (m === SOL_MINT ? "SOL" : `${m.slice(0, 4)}…`);
  const fromFor = (asset: string): string[] => {
    // A coin that pays in its own token is its own source; otherwise every held reward coin quoted in this asset.
    const own = agg.coins.find((c) => c.mint === asset);
    if (own) return [own.symbol ?? sym(asset)];
    return agg.coins.filter((c) => c.quote === asset).map((c) => c.symbol ?? `${c.mint.slice(0, 4)}…`);
  };
  const assets: AssetView[] = Object.entries(agg.assets).map(([mint, a]) => {
    const amount = toAmount(a.raw, a.decimals);
    const p = prices[mint];
    return { mint, symbol: sym(mint), amount, usd: p !== undefined ? amount * p : null, payouts: a.payouts, first: a.first, last: a.last, from: fromFor(mint) };
  });
  assets.sort((x, y) => (y.usd ?? -1) - (x.usd ?? -1) || y.payouts - x.payouts);
  const totalUsd = assets.reduce((s, a) => s + (a.usd ?? 0), 0);
  const allPayouts = assets.reduce((s, a) => s + a.payouts, 0);
  const pricedPayouts = assets.filter((a) => a.usd !== null).reduce((s, a) => s + a.payouts, 0);

  // Cumulative USD per UTC day, every day from the first payout to today, at today's prices.
  const dec = (m: string) => agg.assets[m]?.decimals ?? 0;
  const dayUsd = (d: Record<string, string>) => Object.entries(d).reduce((s, [m, raw]) => s + (prices[m] !== undefined ? toAmount(raw, dec(m)) * prices[m] : 0), 0);
  const series: { t: string; usd: number }[] = [];
  if (agg.firstAt) {
    let acc = 0;
    const end = Date.parse(now.slice(0, 10));
    for (let t = Date.parse(agg.firstAt.slice(0, 10)); t <= end; t += 86_400_000) {
      const key = new Date(t).toISOString().slice(0, 10);
      acc += agg.days[key] ? dayUsd(agg.days[key]) : 0;
      series.push({ t: new Date(t).toISOString(), usd: acc });
    }
    if (series.length === 1) series.unshift({ t: new Date(Date.parse(series[0].t) - 86_400_000).toISOString(), usd: 0 });
  }
  // Last 7 days = the 7 UTC days ending today (today partial); null until the wallet's history is that long or more.
  const cut = new Date(Date.parse(now.slice(0, 10)) - 6 * 86_400_000).toISOString().slice(0, 10);
  const last7dUsd = agg.firstAt ? Object.entries(agg.days).filter(([d]) => d >= cut).reduce((s, [, v]) => s + dayUsd(v), 0) : null;

  return {
    wallet: agg.wallet,
    scannedAt: agg.scannedAt,
    complete: agg.complete,
    payouts: agg.payouts,
    txsScanned: agg.txsScanned,
    firstAt: agg.firstAt,
    lastAt: agg.lastAt,
    totalUsd,
    last7dUsd,
    pricedShare: allPayouts ? pricedPayouts / allPayouts : 1,
    assets,
    series,
    recent: agg.recent.map((r) => ({ ...r, symbol: sym(r.mint), amount: toAmount(r.raw, r.decimals) })),
    coins: agg.coins,
    error: agg.error,
  };
}

export function shareText(v: Pick<WalletView, "totalUsd" | "assets">, fmt: (n: number) => string): string {
  const n = v.assets.length;
  return `I've been paid ${fmt(v.totalUsd)} in StonkFun holder rewards across ${n} ${n === 1 ? "asset" : "assets"}, straight to my wallet. Check yours:`;
}
