import "server-only";
import { getPairs, getRewards, getToken, resolveImage, STONK_MINT, USE_FIXTURES } from "./api";
import { logoDataUri } from "./logo";
import type { CoinCardData } from "./coin-card";
import { getDb } from "./db";
import { getOwnerMints, getTransaction, getTransactionsForAddress } from "./helius";
import { getJupiterTokens } from "./quote-assets";
import { getUsdPrices } from "./jupiter";
import { addPayouts, buildView, classifyTx, distKey, emptyAgg, noteUnexplained, plainTransferSource, type HeldCoin, type Payout, type WalletAgg, type WalletView } from "./wallet-rewards-math";
import type { SupabaseClient } from "@supabase/supabase-js";

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
// Distributors (verified on-chain 2026-10-01, see wallet-rewards-math.ts): 5KXDF6… paid holders until 2026-09-20
// 05:03 UTC, HuBMe… since. The set is the defaults ∪ REWARD_DISTRIBUTORS (env, comma list) ∪ the reward_distributors
// table (migration 0023), which the worker's `reward_distributors` step keeps current by reading who paid StonkFun's
// own latest distributions — so a new distributor is picked up within the hour without a deploy. Every stored wallet
// remembers the set it was built with (`dist_key`); when the set changes it is re-read from the start on its next lookup.

export const KNOWN_DISTRIBUTORS = {
  "5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD": "StonkFun operations wallet; paid holders directly until 2026-09-20 05:03 UTC",
  HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga: "payout wallet funded by 5KXDF6…; pays holders since 2026-09-20 05:03 UTC",
} as const;
const ENV_DISTRIBUTORS = (process.env.REWARD_DISTRIBUTORS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export const REWARD_DISTRIBUTORS: ReadonlySet<string> = new Set([...Object.keys(KNOWN_DISTRIBUTORS), ...ENV_DISTRIBUTORS]);

// Defaults ∪ env ∪ table, cached per instance for 5 minutes. A missing table (0023 not applied) just means the defaults.
const gd = globalThis as typeof globalThis & { __rewardDistributors?: { at: number; set: Set<string> } };
export async function getDistributors(): Promise<ReadonlySet<string>> {
  if (USE_FIXTURES) return REWARD_DISTRIBUTORS;
  if (gd.__rewardDistributors && Date.now() - gd.__rewardDistributors.at < 5 * 60_000) return gd.__rewardDistributors.set;
  const set = new Set(REWARD_DISTRIBUTORS);
  const db = getDb();
  if (db) {
    const { data, error } = await db.from("reward_distributors").select("address");
    if (!error) for (const r of data ?? []) if (r.address) set.add(r.address as string);
  }
  gd.__rewardDistributors = { at: Date.now(), set };
  return set;
}
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
  dist_key?: string | null; unexplained?: Record<string, number> | null; by_distributor?: Record<string, number> | null;
};
const fromRow = (r: Row): WalletAgg => ({
  wallet: r.wallet, scannedAt: r.scanned_at, complete: r.complete, lastSlot: r.last_slot === null ? null : Number(r.last_slot), cursor: r.cursor,
  passFrom: r.pass_from === null ? null : Number(r.pass_from), txsScanned: Number(r.txs_scanned), credits: Number(r.credits), payouts: r.payouts,
  firstAt: r.first_at, lastAt: r.last_at, assets: r.assets ?? {}, days: r.days ?? {}, recent: r.recent ?? [], coins: r.coins ?? [], error: r.error,
  distKey: r.dist_key ?? null, unexplained: r.unexplained ?? {}, byDistributor: r.by_distributor ?? {},
});
const toRow = (a: WalletAgg) => ({
  wallet: a.wallet, scanned_at: a.scannedAt, complete: a.complete, last_slot: a.lastSlot, cursor: a.cursor, pass_from: a.passFrom,
  txs_scanned: a.txsScanned, credits: a.credits, payouts: a.payouts, first_at: a.firstAt, last_at: a.lastAt,
  assets: a.assets, days: a.days, recent: a.recent, coins: a.coins, error: a.error,
  dist_key: a.distKey, unexplained: a.unexplained, by_distributor: a.byDistributor,
});
// 0023 adds dist_key / unexplained / by_distributor; without it the row is saved without them (and never re-read for a
// changed distributor set, since it cannot remember one).
let legacyRows = false;
const legacyRow = (row: ReturnType<typeof toRow>) => {
  const { dist_key: _k, unexplained: _u, by_distributor: _b, ...rest } = row;
  void _k; void _u; void _b;
  return rest;
};

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
type CoinRef = { quote: string; quoteSymbol: string; lastPayoutAt: string; holders: number; distributed: number };
const gi = globalThis as typeof globalThis & { __rewardIndex?: { at: number; map: Map<string, CoinRef> } };
// Reward coin mint → its quote asset, from StonkFun's /rewards ledger (45K launches, ~10 MB: over Next's 2 MB data-cache
// limit, so it is kept per instance for 15 min instead).
async function rewardIndex(): Promise<Map<string, CoinRef>> {
  if (gi.__rewardIndex && Date.now() - gi.__rewardIndex.at < 15 * 60_000) return gi.__rewardIndex.map;
  const r = await getRewards();
  const map = new Map<string, CoinRef>();
  for (const l of r.data.launches) map.set(l.mint, { quote: l.quote.mint, quoteSymbol: l.quote.symbol, lastPayoutAt: l.lastPayoutAt, holders: l.holderCount, distributed: l.distributedTokens });
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

// ---- Per-coin cards (§6o gallery) ----
// Everything one coin card shows, for the reward asset `asset` this wallet received: the held coin(s) that pay in it
// (name, logo, StonkFun's holder count and lifetime payout at today's price), the reward token (symbol, logo) and the
// wallet's figures for that asset. null when the wallet has no card for that asset.
export async function coinCardData(agg: WalletAgg, asset: string, hideWallet: boolean, supplyBurnedPct: number, at: string): Promise<CoinCardData | null> {
  const view = await viewOf(agg, at);
  const g = view.groups.find((x) => x.asset === asset);
  if (!g) return null;
  const [idx, pairs] = await Promise.all([USE_FIXTURES ? Promise.resolve(new Map<string, CoinRef>()) : rewardIndex().catch(() => new Map<string, CoinRef>()), getPairs().catch(() => [])]);
  const ordered = [...g.coins].sort((x, y) => (idx.get(y.mint)?.holders ?? 0) - (idx.get(x.mint)?.holders ?? 0));
  const coinMints = ordered.slice(0, 3).map((c) => c.mint);
  const quoteMints = [...new Set(ordered.map((c) => idx.get(c.mint)?.quote).filter((m): m is string => !!m))];
  const [tokens, jup, prices] = await Promise.all([
    Promise.all(coinMints.map((m) => getToken(m).catch(() => null))),
    getJupiterTokens([...coinMints, asset]).catch(() => new Map()),
    pricesFor([...quoteMints, asset]),
  ]);
  const pair = pairs.find((p) => p.mint === asset);
  const [rewardImg, ...coinImgs] = await Promise.all([
    logoDataUri(resolveImage(pair?.logoUrl) ?? jup.get(asset)?.icon),
    ...coinMints.map((m, i) => logoDataUri(resolveImage(tokens[i]?.data.token.imageUrl) ?? jup.get(m)?.icon)),
  ]);
  const coins = ordered.slice(0, 3).map((c, i) => {
    const ref = idx.get(c.mint);
    const t = tokens[i]?.data.token;
    const qp = ref ? prices[ref.quote] : undefined;
    return { mint: c.mint, symbol: t?.symbol ?? c.symbol, name: t?.name ?? null, image: coinImgs[i] ?? null, holders: ref?.holders ?? null, paidUsd: ref && qp !== undefined ? ref.distributed * qp : null };
  });
  // Every coin in the group counts toward the totals, not just the three drawn.
  for (const c of ordered.slice(3)) {
    const ref = idx.get(c.mint);
    const qp = ref ? prices[ref.quote] : undefined;
    coins.push({ mint: c.mint, symbol: c.symbol, name: null, image: null, holders: ref?.holders ?? null, paidUsd: ref && qp !== undefined ? ref.distributed * qp : null });
  }
  return {
    wallet: agg.wallet,
    hideWallet,
    coins,
    reward: { mint: asset, symbol: pair?.symbol ?? g.symbol, image: rewardImg },
    amount: g.amount,
    usd: g.usd,
    payouts: g.payouts,
    firstAt: g.first,
    last7dUsd: g.last7dUsd,
    supplyBurnedPct,
    at,
  };
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
  const distributors = await getDistributors();
  const key = distKey(distributors);
  // Built with another distributor set or rule version → read the wallet again from the start.
  const stale = !legacyRows && agg.scannedAt !== null && agg.distKey !== key;

  const fresh = !stale && agg.complete && agg.scannedAt && Date.now() - Date.parse(agg.scannedAt) < REWARDS_REFRESH_MIN * 60_000;
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
    const lock = final ? { lock_until: null } : { lock_until: new Date(Date.now() + LOCK_MS).toISOString() };
    const row = toRow(agg);
    let { error } = await db.from("wallet_rewards").update({ ...(legacyRows ? legacyRow(row) : row), ...lock }).eq("wallet", wallet);
    if (error && !legacyRows && /dist_key|unexplained|by_distributor/.test(error.message)) {
      legacyRows = true;
      console.error(`wallet_rewards without 0023 columns, saving without them: ${error.message}`);
      ({ error } = await db.from("wallet_rewards").update({ ...legacyRow(row), ...lock }).eq("wallet", wallet));
    }
    if (error) throw new Error(`save: ${error.message}`);
  };

  if (stale) {
    const credits = agg.credits;
    agg = emptyAgg(wallet);
    agg.credits = credits;
  }
  agg.distKey = key;

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
      const page = await getTransactionsForAddress(wallet, { paginationToken: token, slotGt, withAddress: SCAN_FILTER_WITH ? [...distributors][0] : null });
      pages++;
      meter.credits += page.credits;
      agg.credits += page.credits;
      agg.txsScanned += page.txs.length;
      const payouts: Payout[] = [];
      for (const tx of page.txs) {
        const c = classifyTx(tx, wallet, distributors);
        if (c.kind === "payout") payouts.push(...c.payouts);
        else if (c.kind === "unexplained") noteUnexplained(agg, c.source);
      }
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

// ---- Distributor watch (worker step `reward_distributors`, hourly) ----
// Reads who paid StonkFun's own latest distributions (/rewards `recentDistributions`, the only per-transaction record
// StonkFun publishes) and records each payer in reward_distributors. A payer this site did not know becomes part of
// the set the scan uses on the next lookup (and every stored wallet is re-read once). Only a plain single-asset transfer
// out of one wallet that also signed it counts as "a payer" — the same shape classifyTx accepts.
export function distributorWatchDue(ts: string): boolean {
  const m = new Date(ts).getUTCMinutes();
  return m >= 35 && m < 40;
}
export type DistributorWatch = { sampled: number; recognized: number; payers: Record<string, number>; added: string[]; unrecognized: string[] };
export async function runDistributorWatch(db: SupabaseClient, sample = 6): Promise<DistributorWatch> {
  const r = await getRewards();
  const sigs = [...(r.data.recentDistributions ?? []).map((d) => d.signature)];
  // Spread the sample across the list (newest first) so one busy coin does not fill it.
  const step = Math.max(1, Math.floor(sigs.length / sample));
  const pick = sigs.filter((_, i) => i % step === 0).slice(0, sample);
  const out: DistributorWatch = { sampled: 0, recognized: 0, payers: {}, added: [], unrecognized: [] };
  const known = await getDistributors();
  for (const sig of pick) {
    const tx = await getTransaction(sig).catch(() => null);
    if (!tx) continue;
    out.sampled++;
    const plain = plainTransferSource(tx);
    const keys = tx.transaction.message.accountKeys;
    const n = tx.transaction.message.header?.numRequiredSignatures ?? 0;
    const signed = plain && keys.some((k, i) => (typeof k === "string" ? i < n && k === plain.source : k.pubkey === plain.source && k.signer));
    if (!plain || !signed) {
      out.unrecognized.push(sig);
      continue;
    }
    out.recognized++;
    out.payers[plain.source] = (out.payers[plain.source] ?? 0) + 1;
  }
  const now = new Date().toISOString();
  for (const [address, count] of Object.entries(out.payers)) {
    const isNew = !known.has(address);
    const { data: existing } = await db.from("reward_distributors").select("seen").eq("address", address).maybeSingle();
    const { error } = existing
      ? await db.from("reward_distributors").update({ last_seen: now, seen: (existing.seen ?? 0) + count }).eq("address", address)
      : await db.from("reward_distributors").insert({ address, first_seen: now, last_seen: now, seen: count, source: isNew ? "worker: new payer of StonkFun distributions" : "worker", sample_sig: pick[0] });
    if (error) throw new Error(`reward_distributors: ${error.message}`);
    if (isNew) out.added.push(address);
  }
  if (out.added.length) gd.__rewardDistributors = undefined;
  return out;
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
      payouts.push({ sig: `sample${symbol}${i}`, slot: 1 + i, ts: new Date(t).toISOString(), mint, raw: BigInt(Math.round(total * w * 10 ** decimals)), decimals, by: t < Date.parse("2026-09-20T05:03:44Z") ? "5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD" : "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga" });
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
    { mint: "4DDZYqRUPBFT31uteeXKpHdFUbVoesGhKDBt3qD2nb2c", quote: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", symbol: "SP500", quoteSymbol: "SPYx", lastPayoutAt: new Date(end - 30 * 60_000).toISOString() },
    { mint: "HgcxVs6kJhPAaGqnPNGaa7zYgNT49hJrLufiqcNMuYZT", quote: "So11111111111111111111111111111111111111112", symbol: "BONKY", quoteSymbol: "SOL", lastPayoutAt: new Date(end - 50 * 60_000).toISOString() },
    { mint: "HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ", quote: "GoLDppdjB1vDTPSGxyMJFqdnj134yH6Prg9eqsGDiw6A", symbol: "AUREUS", quoteSymbol: "GOLD", lastPayoutAt: new Date(end - 70 * 60_000).toISOString() },
  ];
  return a;
}
