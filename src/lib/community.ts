import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPairs, getRewards, getToken, getTokenRewards, getTokens, resolveImage, STONK_MINT, USE_FIXTURES } from "./api";
import { getJupiterTokens } from "./quote-assets";
import { COMMUNITY_CARD_ROWS, type CommunityCardData } from "./community-card";
import { getUsdPrices } from "./jupiter";
import { getDb, memoDb } from "./db";
import { COMMUNITY_MODE_LIVE, dailySeries, inferDecimals, splitRaw, toTokens, transitionFor, type CommunityQuoteRow, type ModePeriod } from "./community-math";
import type { RewardLaunch, Token } from "./types";

// StonkFun Community Mode (§6p): which reward coins are in the mode, since when, and how their holder payouts split
// between the coin's holders and holders of its quote token. Pure rules in community-math.ts.
//
// Worker, three cadences (all inside the snapshot tick, step `community`):
//  - every tick: the newest reward launches down to the last one recorded (1 request normally) → reward_launches (mode
//    at launch, never updated), plus the mode of every reward coin the tick's `tokens` step fetched (top 100 by volume);
//  - hourly on the :50 tick (or ?community=1, and in the daily full run): every reward coin with 24h volume ≥ $1, by
//    volume (~25–70 pages). A coin that does not trade earns no fees and pays nothing, so a switch it makes matters only
//    once it trades again — and then it is in this walk within the hour. That is how a coin that SWITCHES into (or out
//    of) the mode after launch is found: its mode is re-read every hour for as long as it pays anything;
//  - every 15 min (:05/:20/:35/:50): StonkFun's /rewards ledger (one ~10 MB read) → each community coin's split
//    (community_coins), repriced with Jupiter; hourly also a per-quote-asset snapshot for the per-day charts.
// A mode change (switch in, leave, new share) is confirmed with a fresh /tokens/{mint} read before it is written, and
// its starting point is the coin's distributed total at that moment (a fresh /tokens/{mint}/rewards read): what was
// paid before the switch stays a plain payout. Detection lags the real switch by up to an hour for coins that trade,
// so a switcher's quote-holder share is understated by at most that hour's payouts — never overstated.

const NEWEST_PAGES = 10;
const SEED_PAGES = 80;          // first run: back to the mode's first day (~45 pages on 2026-10-03)
const VOLUME_FLOOR_USD = 1;     // $1 of daily volume pays holders well under a cent
const VOLUME_PAGES = 90;
const TRANSITION_READS = 40;    // mode changes confirmed per run (2 fresh requests each); the rest wait for the next run
export const COMMUNITY_RETENTION_DAYS = 120;
const CHUNK = 150;

export function communityWalkDue(ts: string): boolean {
  const m = new Date(ts).getUTCMinutes();
  return m >= 50 && m < 55;
}
export function communityTotalsDue(ts: string): boolean {
  const m = new Date(ts).getUTCMinutes() % 15;
  return m >= 5 && m < 10;
}

type OpenRow = { id: number; mint: string; quote_mint: string; share_bps: number };

// Every row of a table (PostgREST caps a response at 1,000 rows). `openOnly` = community_periods with end_ts null.
async function selectAll<T>(db: SupabaseClient, table: "community_periods" | "community_coins", cols: string, openOnly = false): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(cols).order(table === "community_periods" ? "id" : "mint").range(from, from + 999);
    if (openOnly) q = q.is("end_ts", null);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

async function inChunks<T>(mints: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < mints.length; i += CHUNK) out.push(...(await fn(mints.slice(i, i + CHUNK))));
  return out;
}

export type CommunityModesResult = {
  newLaunches: number;
  newCommunity: number;
  observed: number;
  community: number;
  opened: { launch: number; switch: number };
  closed: number;
  rate: number;
  deferred: number;
  seeded: boolean;
  walked: boolean;
  notes: string[];
};

const metaRow = (t: Token, now: string) => ({
  mint: t.mint,
  symbol: t.symbol ?? null,
  name: t.name ?? null,
  image_url: t.imageUrl ?? null,
  quote_mint: t.quote.mint,
  quote_symbol: t.quote.symbol ?? null,
  created_at: t.createdAt,
  status: t.status ?? null,
  market_cap_usd: t.market?.marketCapUsd ?? null,
  share_bps: t.communityMode && t.communityMode.shareBps > 0 ? t.communityMode.shareBps : null,
  seen_at: now,
});

export async function runCommunityModes(db: SupabaseClient, fetched: Token[], opts: { walk: boolean }): Promise<CommunityModesResult> {
  const now = new Date().toISOString();
  const res: CommunityModesResult = { newLaunches: 0, newCommunity: 0, observed: 0, community: 0, opened: { launch: 0, switch: 0 }, closed: 0, rate: 0, deferred: 0, seeded: false, walked: opts.walk, notes: [] };

  // 1. Newest reward launches, down to the newest one already recorded (30 min overlap for late index entries).
  const { data: wm, error: wmErr } = await db.from("reward_launches").select("created_at").order("created_at", { ascending: false }).limit(1);
  if (wmErr) throw new Error(`reward_launches: ${wmErr.message}`);
  const watermark = (wm?.[0] as { created_at: string } | undefined)?.created_at ?? null;
  res.seeded = watermark === null;
  const stopAt = watermark ? new Date(Date.parse(watermark) - 30 * 60_000).toISOString() : COMMUNITY_MODE_LIVE;
  const newest: Token[] = [];
  for (let page = 1; page <= (res.seeded ? SEED_PAGES : NEWEST_PAGES); page++) {
    const r = await getTokens({ mode: "reward", sort: "newest", page, pageSize: 100 });
    const toks = r.data.tokens;
    newest.push(...toks);
    if (!toks.length || toks[toks.length - 1].createdAt < stopAt || page >= r.data.pagination.totalPages) break;
  }
  const launches = newest.filter((t) => t.mode === "reward" && t.createdAt >= COMMUNITY_MODE_LIVE).map((t) => ({
    mint: t.mint, created_at: t.createdAt, quote_mint: t.quote.mint, community: !!(t.communityMode && t.communityMode.shareBps > 0), share_bps: t.communityMode?.shareBps ?? null,
  }));
  for (let i = 0; i < launches.length; i += 500) {
    // ON CONFLICT DO NOTHING: the mode at launch is recorded once and never overwritten by a later switch.
    const { data, error } = await db.from("reward_launches").upsert(launches.slice(i, i + 500), { onConflict: "mint", ignoreDuplicates: true }).select("mint, community");
    if (error) throw new Error(`reward_launches: ${error.message}`);
    res.newLaunches += data?.length ?? 0;
    res.newCommunity += (data ?? []).filter((x) => (x as { community: boolean }).community).length;
  }

  // 2. Hourly: every reward coin that is earning fees, by volume.
  const walked: Token[] = [];
  if (opts.walk) {
    for (let page = 1; page <= VOLUME_PAGES; page++) {
      const r = await getTokens({ mode: "reward", sort: "volume", page, pageSize: 100 });
      const toks = r.data.tokens;
      const live = toks.filter((t) => (t.market?.volume24hUsd ?? 0) >= VOLUME_FLOOR_USD);
      walked.push(...live);
      if (live.length < toks.length || page >= r.data.pagination.totalPages) break;
      if (page === VOLUME_PAGES) res.notes.push(`volume walk stopped at ${VOLUME_PAGES} pages`);
    }
  }

  // 3. What this run saw, one record per coin.
  const seen = new Map<string, Token>();
  for (const t of [...fetched, ...walked, ...newest]) if (t.mode === "reward" && t.mint !== STONK_MINT) seen.set(t.mint, t);
  res.observed = seen.size;
  const isCm = (t: Token) => !!(t.communityMode && t.communityMode.shareBps > 0);
  res.community = [...seen.values()].filter(isCm).length;

  // 4. Current state: every open period (one row per coin in the mode), then launch records / closed periods for the
  //    coins that look newly in the mode.
  const open = new Map((await selectAll<OpenRow>(db, "community_periods", "id, mint, quote_mint, share_bps", true)).map((r) => [r.mint, r]));
  const newCm = [...seen.values()].filter((t) => isCm(t) && !open.has(t.mint)).map((t) => t.mint);
  const launchedAs = new Map<string, "community" | "plain">();
  const hadPeriod = new Set<string>();
  if (newCm.length) {
    const lr = await inChunks(newCm, async (c) => {
      const { data, error } = await db.from("reward_launches").select("mint, community").in("mint", c);
      if (error) throw new Error(`reward_launches: ${error.message}`);
      return (data ?? []) as { mint: string; community: boolean }[];
    });
    for (const r of lr) launchedAs.set(r.mint, r.community ? "community" : "plain");
    const cp = await inChunks(newCm, async (c) => {
      const { data, error } = await db.from("community_periods").select("mint").in("mint", c).not("end_ts", "is", null);
      if (error) throw new Error(`community_periods: ${error.message}`);
      return (data ?? []) as { mint: string }[];
    });
    for (const r of cp) hadPeriod.add(r.mint);
  }

  // 5. Transitions.
  let reads = 0;
  const firstKind = new Map<string, "launch" | "switch">();
  const leftMode: Token[] = [];
  // A fresh read of the coin and of its distributed total, to confirm a change before writing it (list pages can be stale).
  const confirm = async (mint: string): Promise<{ token: Token; raw: string } | null> => {
    reads++;
    const [d, r] = await Promise.all([getToken(mint, { fresh: true }), getTokenRewards(mint, { fresh: true })]);
    if (!d) return null;
    const raw = r?.rewards?.distributedRaw ?? (r?.rewards ? String(Math.round((r.rewards.distributedTokens ?? 0) * 10 ** (r.quote?.decimals ?? 0))) : "0");
    return { token: d.data.token, raw };
  };
  // Launched in the mode: the period starts at 0 on the launch date, no read needed. Inserted in batches (the seed run
  // opens ~900 at once); a batch that hits the one-open-period index (a concurrent tick) is retried row by row.
  const launchRows: { mint: string; quote_mint: string; share_bps: number; start_ts: string; start_raw: string; start_kind: "launch" }[] = [];
  const changes: { t: Token; o: OpenRow | null; tr: NonNullable<ReturnType<typeof transitionFor>> }[] = [];
  for (const t of seen.values()) {
    const o = open.get(t.mint) ?? null;
    const tr = transitionFor(t.communityMode, o ? { shareBps: o.share_bps } : null, { createdAt: t.createdAt, launchedAs: launchedAs.get(t.mint) ?? null, hadPeriod: hadPeriod.has(t.mint) });
    if (!tr) continue;
    if (tr.kind === "open" && tr.startKind === "launch") launchRows.push({ mint: t.mint, quote_mint: t.quote.mint, share_bps: tr.shareBps, start_ts: t.createdAt, start_raw: "0", start_kind: "launch" });
    else changes.push({ t, o, tr });
  }
  for (let i = 0; i < launchRows.length; i += 500) {
    const batch = launchRows.slice(i, i + 500);
    const { error } = await db.from("community_periods").insert(batch);
    if (!error) {
      for (const r of batch) firstKind.set(r.mint, "launch");
      res.opened.launch += batch.length;
      continue;
    }
    if (error.code !== "23505") throw new Error(`community_periods: ${error.message}`);
    for (const r of batch) {
      const { error: e } = await db.from("community_periods").insert(r);
      if (e && e.code !== "23505") throw new Error(`community_periods: ${e.message}`);
      if (!e) { firstKind.set(r.mint, "launch"); res.opened.launch++; }
    }
  }
  for (const { t, o, tr } of changes) {
    if (reads >= TRANSITION_READS) { res.deferred++; continue; }
    const c = await confirm(t.mint);
    if (!c) continue;
    const bpsNow = c.token.communityMode && c.token.communityMode.shareBps > 0 ? c.token.communityMode.shareBps : null;
    if (tr.kind === "open") {
      if (bpsNow === null) continue; // the list page was stale
      const { error } = await db.from("community_periods").insert({ mint: t.mint, quote_mint: t.quote.mint, share_bps: bpsNow, start_ts: now, start_raw: c.raw, start_kind: "switch" });
      if (error && error.code !== "23505") throw new Error(`community_periods: ${error.message}`);
      if (!error) { res.opened.switch++; firstKind.set(t.mint, "switch"); }
      continue;
    }
    // close or rate: o is set
    if (tr.kind === "close" && bpsNow !== null) continue;
    if (tr.kind === "rate" && (bpsNow === null || bpsNow === o!.share_bps)) continue;
    const { error: e1 } = await db.from("community_periods").update({ end_ts: now, end_raw: c.raw, end_kind: tr.kind === "close" ? "revert" : "rate" }).eq("id", o!.id).is("end_ts", null);
    if (e1) throw new Error(`community_periods: ${e1.message}`);
    if (tr.kind === "close") { res.closed++; leftMode.push(c.token); continue; }
    const { error: e2 } = await db.from("community_periods").insert({ mint: t.mint, quote_mint: t.quote.mint, share_bps: bpsNow, start_ts: now, start_raw: c.raw, start_kind: "switch" });
    if (e2 && e2.code !== "23505") throw new Error(`community_periods: ${e2.message}`);
    res.rate++;
  }
  if (res.deferred) res.notes.push(`${res.deferred} mode changes wait for the next run`);

  // 6. Coin records: every community coin seen, coins that just left the mode (share_bps → null), and a coin's first kind.
  const rows = [...seen.values()].filter((t) => isCm(t) && (open.has(t.mint) || firstKind.has(t.mint))).map((t) => metaRow(t, now));
  for (const t of leftMode) rows.push({ ...metaRow(t, now), share_bps: null });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("community_coins").upsert(rows.slice(i, i + 500), { onConflict: "mint" });
    if (error) throw new Error(`community_coins: ${error.message}`);
  }
  const kinds = [...firstKind.entries()];
  for (const k of ["launch", "switch"] as const) {
    const m = kinds.filter(([, v]) => v === k).map(([mint]) => mint);
    for (let i = 0; i < m.length; i += CHUNK) {
      const { error } = await db.from("community_coins").update({ first_kind: k }).in("mint", m.slice(i, i + CHUNK)).is("first_kind", null);
      if (error) throw new Error(`community_coins: ${error.message}`);
    }
  }
  return res;
}

// ---- Totals: StonkFun's ledger × the periods ----

export type CommunityTotalsResult = { coins: number; written: number; repriced: number; snapshot: number; toQuoteUsd: number; unpaid: number };

type PeriodRow = { mint: string; quote_mint: string; share_bps: number; start_raw: string; end_raw: string | null };

export async function runCommunityTotals(db: SupabaseClient, ts: string, opts: { snapshot: boolean; prune: boolean }): Promise<CommunityTotalsResult> {
  const periods = await selectAll<PeriodRow>(db, "community_periods", "mint, quote_mint, share_bps, start_raw, end_raw");
  const byMint = new Map<string, ModePeriod[]>();
  for (const p of periods) {
    const a = byMint.get(p.mint) ?? [];
    a.push({ shareBps: p.share_bps, startRaw: BigInt(p.start_raw), endRaw: p.end_raw === null ? null : BigInt(p.end_raw) });
    byMint.set(p.mint, a);
  }
  const res: CommunityTotalsResult = { coins: byMint.size, written: 0, repriced: 0, snapshot: 0, toQuoteUsd: 0, unpaid: 0 };
  if (!byMint.size) return res;
  const existing = new Map((await selectAll<{ mint: string; distributed_raw: string | null }>(db, "community_coins", "mint, distributed_raw")).map((r) => [r.mint, r.distributed_raw]));
  const ledger = new Map<string, RewardLaunch>((await getRewards()).data.launches.map((l) => [l.mint, l]));
  const quoteOf = new Map(periods.map((p) => [p.mint, p.quote_mint]));

  const rows: Record<string, unknown>[] = [];
  for (const [mint, ps] of byMint) {
    const l = ledger.get(mint);
    if (!l) { res.unpaid++; continue; }
    const dec = l.quote.decimals ?? inferDecimals(l.distributedRaw, l.distributedTokens) ?? 0;
    const rawStr = l.distributedRaw ?? BigInt(Math.round(l.distributedTokens * 10 ** dec)).toString();
    if (existing.get(mint) === rawStr) continue;
    const s = splitRaw(BigInt(rawStr), ps);
    rows.push({
      mint,
      quote_mint: l.quote.mint ?? quoteOf.get(mint),
      quote_symbol: l.quote.symbol,
      quote_decimals: dec,
      distributed_raw: rawStr,
      community_raw: s.communityRaw.toString(),
      to_quote_raw: s.toQuoteRaw.toString(),
      community_tokens: toTokens(s.communityRaw, dec),
      to_quote_tokens: toTokens(s.toQuoteRaw, dec),
      to_coin_tokens: toTokens(s.toCoinRaw, dec),
      payout_count: l.payoutCount,
      holder_count: l.holderCount,
      last_payout_at: l.lastPayoutAt,
      totals_at: ts,
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("community_coins").upsert(rows.slice(i, i + 500), { onConflict: "mint" });
    if (error) throw new Error(`community_coins: ${error.message}`);
  }
  res.written = rows.length;

  const quotes = [...new Set(periods.map((p) => p.quote_mint))];
  const prices = await quotePrices(quotes);
  const { data: n, error: pe } = await db.rpc("community_reprice", { prices });
  if (pe) throw new Error(`community_reprice: ${pe.message}`);
  res.repriced = Number(n ?? 0);
  if (opts.snapshot) {
    const { data: k, error: se } = await db.rpc("community_snapshot", { at: ts });
    if (se) throw new Error(`community_snapshot: ${se.message}`);
    res.snapshot = Number(k ?? 0);
  }
  if (opts.prune) {
    const { error } = await db.rpc("community_snapshots_prune", { keep_days: COMMUNITY_RETENTION_DAYS });
    if (error) throw new Error(`community_snapshots_prune: ${error.message}`);
  }
  const { data: sum } = await db.rpc("community_by_quote");
  res.toQuoteUsd = ((sum ?? []) as { to_quote_usd: number | null }[]).reduce((s, r) => s + (r.to_quote_usd ?? 0), 0);
  return res;
}

// Quote-asset USD prices: Jupiter, STONK at StonkFun's own price (the site's reference).
async function quotePrices(quotes: string[]): Promise<Record<string, number>> {
  const prices = await getUsdPrices(quotes);
  if (quotes.includes(STONK_MINT)) {
    const s = await getToken(STONK_MINT).catch(() => null);
    if (s?.data.token.market?.priceUsd) prices[STONK_MINT] = s.data.token.market.priceUsd;
  }
  return prices;
}

// ---- Reads (page, cards, health) ----

export type CommunityCoin = {
  mint: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  quoteMint: string;
  quoteSymbol: string | null;
  createdAt: string | null;
  status: string | null;
  marketCapUsd: number | null;
  shareBps: number | null;
  firstKind: "launch" | "switch" | null;
  communityTokens: number;
  toQuoteTokens: number;
  toCoinTokens: number;
  toQuoteUsd: number | null;
  toCoinUsd: number | null;
  payoutCount: number | null;
  holderCount: number | null;
  lastPayoutAt: string | null;
  switchedAt: string | null;   // when this site saw the switch (switchers only)
};

export type CommunityOverview = {
  status: "ok" | "no-db" | "db-error" | "empty";
  error?: string;
  byQuote: CommunityQuoteRow[];
  coins: number;
  active: number;
  graduated: number;
  switched: number;
  toQuoteUsd: number;
  toCoinUsd: number;
  payouts: number;
  firstAt: string | null;
  totalsAt: string | null;
  pricedAt: string | null;
  synthetic?: boolean;
};

const COIN_COLS = "mint, symbol, name, image_url, quote_mint, quote_symbol, created_at, status, market_cap_usd, share_bps, first_kind, community_tokens, to_quote_tokens, to_coin_tokens, to_quote_usd, to_coin_usd, payout_count, holder_count, last_payout_at";
type CoinRow = { mint: string; symbol: string | null; name: string | null; image_url: string | null; quote_mint: string; quote_symbol: string | null; created_at: string | null; status: string | null; market_cap_usd: number | null; share_bps: number | null; first_kind: "launch" | "switch" | null; community_tokens: number; to_quote_tokens: number; to_coin_tokens: number; to_quote_usd: number | null; to_coin_usd: number | null; payout_count: number | null; holder_count: number | null; last_payout_at: string | null };
const fromCoinRow = (r: CoinRow): CommunityCoin => ({
  mint: r.mint, symbol: r.symbol, name: r.name, imageUrl: r.image_url, quoteMint: r.quote_mint, quoteSymbol: r.quote_symbol, createdAt: r.created_at, status: r.status,
  marketCapUsd: r.market_cap_usd, shareBps: r.share_bps, firstKind: r.first_kind, communityTokens: Number(r.community_tokens ?? 0), toQuoteTokens: Number(r.to_quote_tokens ?? 0),
  toCoinTokens: Number(r.to_coin_tokens ?? 0), toQuoteUsd: r.to_quote_usd, toCoinUsd: r.to_coin_usd, payoutCount: r.payout_count, holderCount: r.holder_count, lastPayoutAt: r.last_payout_at, switchedAt: null,
});

type QuoteRpc = { quote_mint: string; quote_symbol: string | null; coins: number; active: number; graduated: number; to_quote_tokens: number | null; to_coin_tokens: number | null; to_quote_usd: number | null; to_coin_usd: number | null; payouts: number | null; last_payout_at: string | null; first_at: string | null };

async function getCommunityOverviewImpl(): Promise<CommunityOverview> {
  const empty: CommunityOverview = { status: "ok", byQuote: [], coins: 0, active: 0, graduated: 0, switched: 0, toQuoteUsd: 0, toCoinUsd: 0, payouts: 0, firstAt: null, totalsAt: null, pricedAt: null };
  if (USE_FIXTURES) return (await import("./community-fixture")).fixtureOverview();
  const db = getDb();
  if (!db) return { ...empty, status: "no-db" };
  const [q, sw, at] = await Promise.all([
    db.rpc("community_by_quote"),
    db.from("community_coins").select("mint", { count: "exact", head: true }).eq("first_kind", "switch"),
    db.from("community_coins").select("totals_at, priced_at").order("totals_at", { ascending: false, nullsFirst: false }).limit(1),
  ]);
  if (q.error) return { ...empty, status: "db-error", error: q.error.message };
  const byQuote: CommunityQuoteRow[] = ((q.data ?? []) as QuoteRpc[]).map((r) => ({
    quoteMint: r.quote_mint, quoteSymbol: r.quote_symbol ?? `${r.quote_mint.slice(0, 4)}…`, coins: Number(r.coins), active: Number(r.active), graduated: Number(r.graduated),
    toQuoteTokens: Number(r.to_quote_tokens ?? 0), toCoinTokens: Number(r.to_coin_tokens ?? 0), toQuoteUsd: r.to_quote_usd, toCoinUsd: r.to_coin_usd,
    payouts: Number(r.payouts ?? 0), lastPayoutAt: r.last_payout_at, firstAt: r.first_at,
  }));
  byQuote.sort((a, b) => (b.toQuoteUsd ?? -1) - (a.toQuoteUsd ?? -1) || b.coins - a.coins);
  const top = (at.data?.[0] ?? null) as { totals_at: string | null; priced_at: string | null } | null;
  const sum = (f: (r: CommunityQuoteRow) => number) => byQuote.reduce((s, r) => s + f(r), 0);
  const firsts = byQuote.map((r) => r.firstAt).filter((x): x is string => !!x).sort();
  return {
    status: byQuote.length ? "ok" : "empty",
    byQuote,
    coins: sum((r) => r.coins),
    active: sum((r) => r.active),
    graduated: sum((r) => r.graduated),
    switched: sw.count ?? 0,
    toQuoteUsd: sum((r) => r.toQuoteUsd ?? 0),
    toCoinUsd: sum((r) => r.toCoinUsd ?? 0),
    payouts: sum((r) => r.payouts),
    firstAt: firsts[0] ?? null,
    totalsAt: top?.totals_at ?? null,
    pricedAt: top?.priced_at ?? null,
  };
}
export const getCommunityOverview = memoDb("community-overview", 120, getCommunityOverviewImpl);

// Community coins ranked by what they have sent to quote-token holders (USD at the last repricing); one quote asset or all.
async function getCommunityCoinsImpl(limit: number, quoteMint: string | null): Promise<CommunityCoin[]> {
  if (USE_FIXTURES) return (await import("./community-fixture")).fixtureCoins(limit, quoteMint);
  const db = getDb();
  if (!db) return [];
  let q = db.from("community_coins").select(COIN_COLS).order("to_quote_usd", { ascending: false, nullsFirst: false }).order("community_tokens", { ascending: false }).limit(limit);
  if (quoteMint) q = q.eq("quote_mint", quoteMint);
  const { data, error } = await q;
  if (error) return [];
  const coins = ((data ?? []) as CoinRow[]).map(fromCoinRow);
  const sw = coins.filter((c) => c.firstKind === "switch").map((c) => c.mint);
  if (sw.length) {
    const { data: ps } = await db.from("community_periods").select("mint, start_ts").in("mint", sw).eq("start_kind", "switch").order("start_ts");
    const first = new Map<string, string>();
    for (const p of (ps ?? []) as { mint: string; start_ts: string }[]) if (!first.has(p.mint)) first.set(p.mint, p.start_ts);
    for (const c of coins) c.switchedAt = first.get(c.mint) ?? null;
  }
  return coins;
}
export const getCommunityCoins = memoDb("community-coins", 120, getCommunityCoinsImpl);

// Every coin that is or was in Community Mode, with how much of its lifetime payout was split — for tagging and splitting
// rows of StonkFun's live ledger (/rewards All and Plain views, /tokens). Compact tuples: the cache entry stays under
// Next's 2 MB data-cache limit to ~25K coins; past that it is read per render (still one query per 1,000 coins).
export type CommunityTag = { shareBps: number | null; communityTokens: number; toQuoteTokens: number; firstKind: "launch" | "switch" | null };
type TagTuple = [string, number | null, number, number, "launch" | "switch" | null];
async function getCommunitySetImpl(): Promise<TagTuple[]> {
  if (USE_FIXTURES) return (await (await import("./community-fixture")).fixtureCoins(10_000, null)).map((c) => [c.mint, c.shareBps, c.communityTokens, c.toQuoteTokens, c.firstKind]);
  const db = getDb();
  if (!db) return [];
  try {
    const rows = await selectAll<{ mint: string; share_bps: number | null; community_tokens: number; to_quote_tokens: number; first_kind: "launch" | "switch" | null }>(db, "community_coins", "mint, share_bps, community_tokens, to_quote_tokens, first_kind");
    return rows.map((r) => [r.mint, r.share_bps, Number(r.community_tokens ?? 0), Number(r.to_quote_tokens ?? 0), r.first_kind]);
  } catch {
    return [];
  }
}
const getCommunitySetMemo = memoDb("community-set", 120, getCommunitySetImpl);
export async function getCommunitySet(): Promise<Map<string, CommunityTag>> {
  const t = await getCommunitySetMemo();
  return new Map(t.map(([mint, shareBps, communityTokens, toQuoteTokens, firstKind]) => [mint, { shareBps, communityTokens, toQuoteTokens, firstKind }]));
}

// Traction: reward launches per UTC day (community vs plain) and the quote-holder share paid per day (USD at the last
// repricing's price per quote asset — so a day's bar does not move with the quote's price between reads).
export type CommunityTraction = {
  days: { date: string; launches: number; community: number }[];
  paidPerDay: { date: string; value: number }[];
};
async function getCommunityTractionImpl(days: number): Promise<CommunityTraction> {
  if (USE_FIXTURES) return (await import("./community-fixture")).fixtureTraction();
  const db = getDb();
  if (!db) return { days: [], paidPerDay: [] };
  const since = new Date(Math.max(Date.parse(COMMUNITY_MODE_LIVE), Date.now() - days * 864e5)).toISOString();
  const [ld, cd, ov] = await Promise.all([db.rpc("reward_launch_days", { since }), db.rpc("community_daily", { since }), getCommunityOverview()]);
  const launchDays = ((ld.data ?? []) as { day: string; launches: number; community: number }[]).map((r) => ({ date: r.day, launches: Number(r.launches), community: Number(r.community) }));
  const prices: Record<string, number> = {};
  for (const q of ov.byQuote) if (q.toQuoteUsd !== null && q.toQuoteTokens > 0) prices[q.quoteMint] = q.toQuoteUsd / q.toQuoteTokens;
  const rows = ((cd.data ?? []) as { day: string; quote_mint: string; to_quote_tokens: number }[]).map((r) => ({ day: r.day, quoteMint: r.quote_mint, toQuoteTokens: Number(r.to_quote_tokens) }));
  return { days: launchDays, paidPerDay: dailySeries(rows, prices, COMMUNITY_MODE_LIVE.slice(0, 10)) };
}
export const getCommunityTraction = memoDb("community-traction", 300, getCommunityTractionImpl);

// One quote asset: its row + its top coins (the share card and /pairs/{mint}).
export type CommunityQuoteView = { row: CommunityQuoteRow; coins: CommunityCoin[]; totalsAt: string | null; synthetic?: boolean };
export async function getCommunityQuote(quoteMint: string, top = 5): Promise<CommunityQuoteView | null> {
  const [ov, coins] = await Promise.all([getCommunityOverview(), getCommunityCoins(top, quoteMint)]);
  const row = ov.byQuote.find((r) => r.quoteMint === quoteMint);
  if (!row) return null;
  return { row, coins, totalsAt: ov.totalsAt, synthetic: ov.synthetic };
}

// /api/health → community: the worker's state, read directly (not memo'd). Throws when a migration is missing or the
// totals / snapshots stall.
export async function communityHealth(): Promise<string> {
  const db = getDb();
  if (!db) return "not configured (needs supabase)";
  const [open, closed, sw, last, tot, snap] = await Promise.all([
    db.from("community_periods").select("id", { count: "exact", head: true }).is("end_ts", null),
    db.from("community_periods").select("id", { count: "exact", head: true }).not("end_ts", "is", null),
    db.from("community_periods").select("id", { count: "exact", head: true }).eq("start_kind", "switch"),
    db.from("reward_launches").select("created_at").order("created_at", { ascending: false }).limit(1),
    db.from("community_coins").select("totals_at, priced_at").order("totals_at", { ascending: false, nullsFirst: false }).limit(1),
    db.from("community_quote_snapshots").select("ts").order("ts", { ascending: false }).limit(1),
  ]);
  const err = open.error ?? last.error ?? tot.error ?? snap.error;
  if (err) throw new Error(`${err.message} (migration 0024 applied?)`);
  const age = (iso: string | null | undefined) => (iso ? (Date.now() - Date.parse(iso)) / 60_000 : null);
  const lastLaunch = (last.data?.[0] as { created_at: string } | undefined)?.created_at ?? null;
  const t = tot.data?.[0] as { totals_at: string | null; priced_at: string | null } | undefined;
  const s = (snap.data?.[0] as { ts: string } | undefined)?.ts ?? null;
  const note = `${open.count ?? 0} coins in the mode (${sw.count ?? 0} switch periods, ${closed.count ?? 0} closed) · newest launch recorded ${lastLaunch ? `${age(lastLaunch)!.toFixed(0)} min ago` : "never"} · totals ${t?.totals_at ? `${age(t.totals_at)!.toFixed(0)} min ago` : "never"} · hourly snapshot ${s ? `${age(s)!.toFixed(0)} min ago` : "never"}`;
  if (!lastLaunch) throw new Error(`not seeded yet: ${note}`);
  if ((age(lastLaunch) ?? 0) > 60) throw new Error(`no reward launch recorded for over an hour (worker stalled, or StonkFun's index stopped listing new launches): ${note}`);
  if ((open.count ?? 0) > 0 && (age(t?.priced_at) ?? 999) > 40) throw new Error(`totals / prices older than 40 min: ${note}`);
  if ((open.count ?? 0) > 0 && (age(s) ?? 999) > 150) throw new Error(`hourly snapshot older than 2.5 h: ${note}`);
  return note;
}

// ---- Share cards (§6p) ----
export async function communityCardData(quoteMint: string | null, supplyBurnedPct: number, at: string): Promise<CommunityCardData | null> {
  const ov = await getCommunityOverview();
  if (ov.status !== "ok") return null;
  const [pairs, cardLogo] = await Promise.all([getPairs().catch(() => []), import("./logo").then((m) => m.logoDataUri)]);
  const pairLogo = new Map(pairs.map((p) => [p.mint, resolveImage(p.logoUrl)]));
  const shareBps = 3300;
  if (!quoteMint) {
    const top = ov.byQuote.slice(0, COMMUNITY_CARD_ROWS);
    const jup = await getJupiterTokens(top.filter((q) => !pairLogo.get(q.quoteMint)).map((q) => q.quoteMint)).catch(() => new Map());
    const images = await Promise.all(top.map((q) => cardLogo(pairLogo.get(q.quoteMint) ?? jup.get(q.quoteMint)?.icon)));
    const rest = ov.byQuote.slice(COMMUNITY_CARD_ROWS);
    return {
      kind: "all", quote: null, usd: ov.toQuoteUsd, tokens: null, coinHoldersUsd: ov.toCoinUsd, coins: ov.coins, active: ov.active, quoteAssets: ov.byQuote.length, shareBps, firstAt: ov.firstAt,
      rows: top.map((q, i) => ({ key: q.quoteMint, label: q.quoteSymbol, sub: `${q.coins.toLocaleString("en-US")} ${q.coins === 1 ? "COIN" : "COINS"}`, image: images[i], usd: q.toQuoteUsd })),
      restCount: rest.length, restUsd: rest.reduce((s, q) => s + (q.toQuoteUsd ?? 0), 0), supplyBurnedPct, at, synthetic: ov.synthetic,
    };
  }
  const q = await getCommunityQuote(quoteMint, COMMUNITY_CARD_ROWS);
  if (!q) return null;
  const jup = await getJupiterTokens([quoteMint, ...q.coins.filter((c) => !c.imageUrl).map((c) => c.mint)]).catch(() => new Map());
  const [qImg, ...coinImgs] = await Promise.all([cardLogo(pairLogo.get(quoteMint) ?? jup.get(quoteMint)?.icon), ...q.coins.map((c) => cardLogo(resolveImage(c.imageUrl ?? undefined) ?? jup.get(c.mint)?.icon))]);
  const shown = q.coins.reduce((s, c) => s + (c.toQuoteUsd ?? 0), 0);
  return {
    kind: "quote", quote: { mint: quoteMint, symbol: q.row.quoteSymbol, image: qImg }, usd: q.row.toQuoteUsd ?? 0, tokens: q.row.toQuoteTokens, coinHoldersUsd: q.row.toCoinUsd,
    coins: q.row.coins, active: q.row.active, quoteAssets: 1, shareBps, firstAt: q.row.firstAt,
    rows: q.coins.map((c, i) => ({ key: c.mint, label: c.symbol ?? `${c.mint.slice(0, 4)}…`, sub: c.firstKind === "switch" ? `SWITCHED IN ${c.switchedAt ? new Date(c.switchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase() : ""}`.trim() : c.status === "graduated" ? "GRADUATED" : "BONDING", image: coinImgs[i], usd: c.toQuoteUsd })),
    restCount: Math.max(0, q.row.coins - q.coins.length), restUsd: Math.max(0, (q.row.toQuoteUsd ?? 0) - shown), supplyBurnedPct, at, synthetic: q.synthetic,
  };
}
