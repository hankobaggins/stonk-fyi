import "server-only";
import { getPairs, getRewards, getToken, STONK_MINT, USE_FIXTURES } from "./api";
import { getDb } from "./db";
import { getOwnerMints, getTransactionsForAddress } from "./helius";
import { getJupiterTokens } from "./quote-assets";
import { getUsdPrices } from "./jupiter";
import { addPayouts, buildView, emptyAgg, payoutsIn, type HeldCoin, type WalletAgg, type WalletView } from "./wallet-rewards-math";

// Wallet rewards check (CLAUDE.md §6o, 2026-10-01): what StonkFun's holder-reward distributor has paid one wallet.
// StonkFun's API has no per-wallet figure, so this reads the chain: Helius getTransactionsForAddress over the
// wallet's history (its token accounts included), keeping the transactions a distributor signed, and folds the
// increases into one wallet_rewards row (migration 0022). Only that wallet, only when someone asks, only totals kept.
//
// Bounded three ways, like the token-page HolderScan reads (§6l):
// 1. Incremental: a wallet is scanned from genesis once; a refresh reads only slots after `last_slot`, and an
//    unfinished pass resumes from Helius's own cursor. A refresh is skipped inside REWARDS_REFRESH_MIN (10).
// 2. One scan per wallet at a time (`lock_until`): a second request watches the first one's progress instead.
// 3. A per-instance credit budget, HELIUS_REWARDS_CREDITS_PER_H (default 60,000 ≈ 600K transactions an hour). Over
//    budget, the pass stops where it is, keeps its cursor and the page says so; the next request continues it.
//    A request also stops after REWARDS_SCAN_BUDGET_MS (240 s) and the page re-requests to continue.
//
// Distributors: REWARD_DISTRIBUTORS (comma list). Default is the one wallet seen signing every payout on 2026-10-01.
// Earlier payouts may have come from another — /api/rewards/probe lists who paid a wallet, by month.

export const DEFAULT_DISTRIBUTOR = "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga";
export const REWARD_DISTRIBUTORS: ReadonlySet<string> = new Set(
  (process.env.REWARD_DISTRIBUTORS ?? DEFAULT_DISTRIBUTOR).split(",").map((s) => s.trim()).filter(Boolean),
);
export const REWARDS_REFRESH_MIN = Math.max(1, Number(process.env.REWARDS_REFRESH_MIN ?? 10));
export const REWARDS_CREDITS_PER_H = Math.max(0, Number(process.env.HELIUS_REWARDS_CREDITS_PER_H ?? 60_000));
const SCAN_BUDGET_MS = Math.max(20_000, Number(process.env.REWARDS_SCAN_BUDGET_MS ?? 240_000));
const LOCK_MS = SCAN_BUDGET_MS + 60_000;
const SCAN_FILTER_WITH = process.env.REWARDS_SCAN_FILTER === "with"; // narrow pages to transfers in from the distributor (see helius.ts)

export const rewardsEnabled = () => USE_FIXTURES || !!process.env.HELIUS_API_KEY;

// ---- Per-instance meter (globalThis: every route is its own bundle) ----
type Meter = { hour: number; credits: number; scans: number; refused: number; lastScan: string | null; lastError: string | null };
const g = globalThis as typeof globalThis & { __rewardsMeter?: Meter };
export function rewardsMeter(): Meter {
  const hour = Math.floor(Date.now() / 3.6e6);
  if (!g.__rewardsMeter || g.__rewardsMeter.hour !== hour) g.__rewardsMeter = { hour, credits: 0, scans: 0, refused: 0, lastScan: g.__rewardsMeter?.lastScan ?? null, lastError: g.__rewardsMeter?.lastError ?? null };
  return g.__rewardsMeter;
}

// ---- Row ↔ aggregate ----
type Row = {
  wallet: string; scanned_at: string | null; complete: boolean; last_slot: number | null; cursor: string | null; pass_from: number | null;
  txs_scanned: number; credits: number; payouts: number; first_at: string | null; last_at: string | null;
  assets: WalletAgg["assets"]; days: WalletAgg["days"]; recent: WalletAgg["recent"]; coins: HeldCoin[]; lock_until: string | null; error: string | null;
};
const fromRow = (r: Row): WalletAgg => ({
  wallet: r.wallet, scannedAt: r.scanned_at, complete: r.complete, lastSlot: r.last_slot === null ? null : Number(r.last_slot), cursor: r.cursor,
  passFrom: r.pass_from === null ? null : Number(r.pass_from), txsScanned: Number(r.txs_scanned), credits: Number(r.credits), payouts: r.payouts,
  firstAt: r.first_at, lastAt: r.last_at, assets: r.assets ?? {}, days: r.days ?? {}, recent: r.recent ?? [], coins: r.coins ?? [], error: r.error,
});
const toRow = (a: WalletAgg) => ({
  wallet: a.wallet, scanned_at: a.scannedAt, complete: a.complete, last_slot: a.lastSlot, cursor: a.cursor, pass_from: a.passFrom,
  txs_scanned: a.txsScanned, credits: a.credits, payouts: a.payouts, first_at: a.firstAt, last_at: a.lastAt,
  assets: a.assets, days: a.days, recent: a.recent, coins: a.coins, error: a.error,
});

// Stored aggregate for a wallet (page and card reads: the page deadline, no retries). null = never scanned / no DB.
export async function loadWalletAgg(wallet: string): Promise<WalletAgg | null> {
  if (USE_FIXTURES) return sampleAgg(wallet);
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.from("wallet_rewards").select("*").eq("wallet", wallet).maybeSingle();
  if (error || !data) return null;
  return fromRow(data as Row);
}

// ---- Reference data: reward coins, symbols, prices ----
type CoinRef = { quote: string; quoteSymbol: string; lastPayoutAt: string };
const gi = globalThis as typeof globalThis & { __rewardIndex?: { at: number; map: Map<string, CoinRef> } };
// Reward coin mint → its quote asset, from StonkFun's /rewards ledger (45K launches, ~10 MB: over Next's 2 MB data-cache
// limit, so it is kept per instance for 15 min instead).
async function rewardIndex(): Promise<Map<string, CoinRef>> {
  if (gi.__rewardIndex && Date.now() - gi.__rewardIndex.at < 15 * 60_000) return gi.__rewardIndex.map;
  const r = await getRewards();
  const map = new Map<string, CoinRef>();
  for (const l of r.data.launches) map.set(l.mint, { quote: l.quote.mint, quoteSymbol: l.quote.symbol, lastPayoutAt: l.lastPayoutAt });
  gi.__rewardIndex = { at: Date.now(), map };
  return map;
}

export async function symbolsFor(mints: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const pairs = await getPairs().catch(() => []);
  for (const p of pairs) out[p.mint] = p.symbol;
  const missing = mints.filter((m) => !out[m]);
  if (missing.length) {
    const jt = await getJupiterTokens(missing).catch(() => new Map());
    for (const [m, t] of jt) if (t.symbol) out[m] = t.symbol;
  }
  return out;
}

// USD now: Jupiter, STONK at StonkFun's price (the site's reference, as on /rewards).
export async function pricesFor(mints: string[]): Promise<Record<string, number>> {
  const [prices, stonk] = await Promise.all([getUsdPrices(mints), mints.includes(STONK_MINT) ? getToken(STONK_MINT).catch(() => null) : null]);
  const p = stonk?.data.token.market?.priceUsd;
  if (p) prices[STONK_MINT] = p;
  return prices;
}

export async function viewOf(agg: WalletAgg, now = new Date().toISOString()): Promise<WalletView> {
  if (USE_FIXTURES) return buildView(agg, SAMPLE_PRICES, {}, now);
  const mints = Object.keys(agg.assets);
  const [prices, symbols] = await Promise.all([pricesFor(mints), symbolsFor(mints)]);
  return buildView(agg, prices, symbols, now);
}

// Reward coins the wallet holds now, with their quote asset — the "from" side of the breakdown (inferred: the chain
// does not say which coin a payout was for) and the empty-state diagnostics.
async function heldCoins(wallet: string): Promise<{ coins: HeldCoin[]; credits: number }> {
  const [{ mints, credits }, idx] = await Promise.all([getOwnerMints(wallet), rewardIndex()]);
  const held = mints.filter((m) => idx.has(m));
  const syms = held.length ? await getJupiterTokens(held).catch(() => new Map()) : new Map();
  const coins = held.map((m) => {
    const c = idx.get(m)!;
    return { mint: m, quote: c.quote, quoteSymbol: c.quoteSymbol, symbol: syms.get(m)?.symbol, lastPayoutAt: c.lastPayoutAt };
  });
  coins.sort((a, b) => (b.lastPayoutAt ?? "").localeCompare(a.lastPayoutAt ?? ""));
  return { coins: coins.slice(0, 50), credits };
}

// ---- The scan ----
export type ScanReason = "fresh" | "complete" | "time" | "rationed" | "elsewhere" | "no-db";
export type ScanEvent =
  | { type: "progress"; view: WalletView; pages: number; txs: number }
  | { type: "done"; view: WalletView; reason: ScanReason }
  | { type: "error"; message: string; view: WalletView | null };

export async function* scanWallet(wallet: string, opts: { force?: boolean } = {}): AsyncGenerator<ScanEvent> {
  if (USE_FIXTURES) {
    const a = sampleAgg(wallet);
    yield { type: "done", view: await viewOf(a), reason: "complete" };
    return;
  }
  if (!process.env.HELIUS_API_KEY) {
    yield { type: "error", message: "on-chain reads are not configured on this deployment", view: null };
    return;
  }
  const meter = rewardsMeter();
  let db = getDb({ timeoutMs: 15_000, retry: false });
  const now = () => new Date().toISOString();
  let agg = (db ? await loadWalletAgg(wallet) : null) ?? emptyAgg(wallet);

  const fresh = agg.complete && agg.scannedAt && Date.now() - Date.parse(agg.scannedAt) < REWARDS_REFRESH_MIN * 60_000;
  if (fresh && !opts.force) {
    yield { type: "done", view: await viewOf(agg), reason: "fresh" };
    return;
  }

  // Claim the wallet. A row that does not exist yet is created unlocked first, then claimed like any other.
  if (db) {
    const { error: upErr } = await db.from("wallet_rewards").upsert({ wallet }, { onConflict: "wallet", ignoreDuplicates: true });
    if (upErr) {
      // Table missing (0022 not applied) or DB down: scan anyway, store nothing.
      console.error(`wallet_rewards unavailable, scanning without storage: ${upErr.message}`);
      meter.lastError = `${now()} wallet_rewards: ${upErr.message.slice(0, 160)}`;
      db = null;
    }
  }
  if (db) {
    const until = new Date(Date.now() + LOCK_MS).toISOString();
    const { data: claimed } = await db
      .from("wallet_rewards")
      .update({ lock_until: until })
      .eq("wallet", wallet)
      .or(`lock_until.is.null,lock_until.lt.${now()}`)
      .select("wallet");
    if (!claimed?.length) {
      // Someone else is scanning this wallet: relay their progress from the row until they finish (or 2 min pass).
      const t0 = Date.now();
      while (Date.now() - t0 < 120_000) {
        await new Promise((r) => setTimeout(r, 3_000));
        const { data } = await db.from("wallet_rewards").select("*").eq("wallet", wallet).maybeSingle();
        if (!data) break;
        agg = fromRow(data as Row);
        const r = data as Row;
        if (!r.lock_until || Date.parse(r.lock_until) < Date.now()) break;
        yield { type: "progress", view: await viewOf(agg), pages: 0, txs: agg.txsScanned };
      }
      yield { type: "done", view: await viewOf(agg), reason: "elsewhere" };
      return;
    }
  }

  const save = async (final: boolean) => {
    if (!db) return;
    const { error } = await db.from("wallet_rewards").update({ ...toRow(agg), ...(final ? { lock_until: null } : { lock_until: new Date(Date.now() + LOCK_MS).toISOString() }) }).eq("wallet", wallet);
    if (error) throw new Error(`save: ${error.message}`);
  };

  const t0 = Date.now();
  let pages = 0;
  let reason: ScanReason = db ? "complete" : "no-db";
  try {
    meter.scans++;
    meter.lastScan = now();
    agg.error = null;
    const held = await heldCoins(wallet);
    agg.coins = held.coins;
    agg.credits += held.credits;
    meter.credits += held.credits;

    // Resume an unfinished pass with its cursor and its own slot filter, or start a new pass after the last slot read.
    let token = agg.cursor;
    const slotGt = token ? agg.passFrom : agg.lastSlot;
    agg.passFrom = slotGt;
    agg.complete = false;
    const distributors = [...REWARD_DISTRIBUTORS];
    for (;;) {
      if (meter.credits + 100 > REWARDS_CREDITS_PER_H) {
        meter.refused++;
        reason = "rationed";
        break;
      }
      if (Date.now() - t0 > SCAN_BUDGET_MS) {
        reason = "time";
        break;
      }
      const page = await getTransactionsForAddress(wallet, { paginationToken: token, slotGt, withAddress: SCAN_FILTER_WITH ? distributors[0] : null });
      pages++;
      meter.credits += page.credits;
      agg.credits += page.credits;
      agg.txsScanned += page.txs.length;
      const payouts = page.txs.flatMap((tx) => payoutsIn(tx, wallet, REWARD_DISTRIBUTORS));
      addPayouts(agg, payouts);
      for (const tx of page.txs) if (agg.lastSlot === null || tx.slot > agg.lastSlot) agg.lastSlot = tx.slot;
      token = page.paginationToken;
      agg.cursor = token;
      if (!token) {
        agg.complete = true;
        agg.passFrom = null;
      }
      agg.scannedAt = now();
      await save(false);
      yield { type: "progress", view: await viewOf(agg), pages, txs: agg.txsScanned };
      if (!token) break;
    }
  } catch (e) {
    const msg = (e as Error).message;
    agg.error = msg.slice(0, 300);
    meter.lastError = `${now()} ${wallet.slice(0, 4)}…: ${msg.slice(0, 200)}`;
    console.error(`wallet rewards scan ${wallet}: ${msg}`);
    agg.scannedAt = now();
    await save(true).catch(() => {});
    yield { type: "error", message: msg, view: await viewOf(agg).catch(() => null) };
    return;
  }
  agg.scannedAt = now();
  await save(true).catch((e) => console.error(`wallet rewards save ${wallet}: ${(e as Error).message}`));
  yield { type: "done", view: await viewOf(agg), reason };
}

// ---- Fixture mode: a synthetic, labelled sample (no network in DATA_SOURCE=fixture) ----
const SAMPLE_PRICES: Record<string, number> = {
  XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W: 674.2, [STONK_MINT]: 0.15, So11111111111111111111111111111111111111112: 150, GoLDppdjB1vDTPSGxyMJFqdnj134yH6Prg9eqsGDiw6A: 4135, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1,
};
export function sampleAgg(wallet: string): WalletAgg {
  const a = emptyAgg(wallet);
  const end = Date.parse("2026-10-01T16:00:00Z");
  if (wallet.startsWith("1111")) {
    // The empty state: a wallet that holds a reward coin but was never paid.
    Object.assign(a, { complete: true, scannedAt: new Date(end).toISOString(), txsScanned: 37 });
    a.coins = [{ mint: "8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS", quote: STONK_MINT, symbol: "MOONCAT", quoteSymbol: "STONK", lastPayoutAt: new Date(end - 11 * 60_000).toISOString() }];
    return a;
  }
  const start = Date.parse("2026-08-09T00:00:00Z");
  const assets: [string, string, number, number][] = [
    ["XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", "SPYx", 8, 9.81],
    [STONK_MINT, "STONK", 6, 21_400],
    ["So11111111111111111111111111111111111111112", "SOL", 9, 7.8],
    ["GoLDppdjB1vDTPSGxyMJFqdnj134yH6Prg9eqsGDiw6A", "GOLD", 6, 0.118],
    ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC", 6, 240.5],
  ];
  const n = 60;
  for (const [mint, symbol, decimals, total] of assets) {
    const payouts = [];
    for (let i = 0; i < n; i++) {
      const t = start + ((end - start) * (i + 0.5)) / n;
      const w = (i + 1) / ((n * (n + 1)) / 2); // rising
      payouts.push({ sig: `sample${symbol}${i}`, slot: 1 + i, ts: new Date(t).toISOString(), mint, raw: BigInt(Math.round(total * w * 10 ** decimals)), decimals });
    }
    addPayouts(a, payouts);
    a.assets[mint].symbol = symbol;
  }
  a.payouts = 4_812;
  a.txsScanned = 5_230;
  a.complete = true;
  a.scannedAt = new Date(end).toISOString();
  a.coins = [
    { mint: "CN8aRKzBX7x4pu8kjb1EWJmUXDk5Ff7VNYZw56pJ8AWC", quote: "GoLDppdjB1vDTPSGxyMJFqdnj134yH6Prg9eqsGDiw6A", symbol: "GILD", quoteSymbol: "GOLD", lastPayoutAt: new Date(end - 4 * 60_000).toISOString() },
    { mint: "8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS", quote: STONK_MINT, symbol: "MOONCAT", quoteSymbol: "STONK", lastPayoutAt: new Date(end - 11 * 60_000).toISOString() },
  ];
  return a;
}
