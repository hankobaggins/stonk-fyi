import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTokens, STONK_MINT } from "./api";
import { getDb, memoDb } from "./db";
import type { Token } from "./types";
import { type CohortToken, countCohort, countWindow, crossingStatus, linesCrossed, peakOf, RUNNER_FLOOR, RUNNER_LINES, type RunnerRow, type WindowCounts } from "./runner-math";

// Runners (§6k, 2026-09-17): which StonkFun tokens crossed $1M / $5M / $10M / $25M / $50M / $100M market
// cap, and when. StonkFun gives every token a lifetime peakMarketCapUsd; a peak only rises, so a token
// crosses a line once and `mcap_milestones (mint, threshold_usd)` counts nothing twice. The worker's
// `runners` step runs every tick over the tokens the tick already fetched (top 100 by volume; 500 hourly;
// every token daily) plus one page of the top 100 by market cap. The first run seeds every crossing
// that already happened (status seeded, no reached_at), so the 24h / 7d counts start from zero.

const CHUNK = 150; // mints per PostgREST `in` filter (URL length)

type DbRow = {
  mint: string; threshold_usd: number; symbol: string | null; name: string | null; quote_symbol: string | null; created_at: string | null;
  ts: string; reached_at: string | null; after_ts: string | null; mode: string | null; peak_usd: number; market_cap_usd: number | null; status: string;
};
const fromDb = (r: DbRow): RunnerRow => ({
  mint: r.mint, thresholdUsd: r.threshold_usd, symbol: r.symbol, name: r.name, quoteSymbol: r.quote_symbol, createdAt: r.created_at,
  reachedAt: r.reached_at, afterTs: r.after_ts, mode: r.mode, peakUsd: r.peak_usd, marketCapUsd: r.market_cap_usd, status: r.status,
});

async function chunked<T>(mints: string[], fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < mints.length; i += CHUNK) out.push(...(await fn(mints.slice(i, i + CHUNK))));
  return out;
}

// ---------- worker ----------

export type RunnersResult = { created: number; seeded: number; crossed: string[]; candidates: number };

// `tokens` = every token this tick fetched; `prevSeen` = tokens.last_seen_at before this tick's upsert for
// the mints in `tokens` (null = never seen). Tokens from the extra market-cap page are looked up live,
// since the tokens step does not upsert them.
export async function runRunners(
  db: SupabaseClient,
  tokens: Token[],
  prevSeen: Map<string, string | null>,
  opts: { ts: string; mode: "tick" | "hourly" | "full" }
): Promise<RunnersResult> {
  const now = Date.parse(opts.ts);
  const byMint = new Map<string, Token>();
  for (const t of tokens) byMint.set(t.mint, t);
  try {
    const page = await getTokens({ sort: "marketCap", pageSize: 100 });
    for (const t of page.data.tokens) if (!byMint.has(t.mint)) byMint.set(t.mint, t);
  } catch {
    /* the tick's own tokens still count */
  }
  // STONK itself is the platform token, not a launched runner: never on the ladder.
  const candidates = [...byMint.values()].filter((t) => t.mint !== STONK_MINT && peakOf(t.market) >= RUNNER_FLOOR);
  if (!candidates.length) return { created: 0, seeded: 0, crossed: [], candidates: 0 };
  const mints = candidates.map((t) => t.mint);

  const { data: any1, error: e0 } = await db.from("mcap_milestones").select("mint").limit(1);
  if (e0) throw new Error(e0.message);
  const empty = !any1?.length;

  const existing = new Set<string>();
  if (!empty) {
    const rows = await chunked(mints, async (part) => {
      const { data, error } = await db.from("mcap_milestones").select("mint, threshold_usd").in("mint", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as { mint: string; threshold_usd: number }[];
    });
    for (const r of rows) existing.add(`${r.mint}:${r.threshold_usd}`);
  }

  // Previous sighting for candidates the tokens step did not upsert (the market-cap page).
  const unknown = mints.filter((m) => !prevSeen.has(m));
  if (unknown.length && !empty) {
    const rows = await chunked(unknown, async (part) => {
      const { data, error } = await db.from("tokens").select("mint, last_seen_at").in("mint", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as { mint: string; last_seen_at: string | null }[];
    });
    for (const m of unknown) prevSeen.set(m, null);
    for (const r of rows) prevSeen.set(r.mint, r.last_seen_at);
  }

  const inserts: Omit<DbRow, "ts">[] = [];
  for (const t of candidates) {
    const peak = peakOf(t.market);
    const after = prevSeen.get(t.mint) ?? null;
    const status = empty ? "seeded" : crossingStatus(after, t.createdAt, now);
    for (const line of linesCrossed(peak)) {
      if (existing.has(`${t.mint}:${line}`)) continue;
      inserts.push({
        mint: t.mint, threshold_usd: line, symbol: t.symbol, name: t.name, quote_symbol: t.quote.symbol, created_at: t.createdAt,
        reached_at: status === "crossed" ? opts.ts : null, after_ts: status === "crossed" ? after : null, mode: opts.mode,
        peak_usd: peak, market_cap_usd: t.market?.marketCapUsd ?? null, status,
      });
    }
  }
  if (!inserts.length) return { created: 0, seeded: 0, crossed: [], candidates: candidates.length };
  // ON CONFLICT DO NOTHING: a concurrent tick inserting the same (mint, line) loses quietly.
  const { data, error } = await db.from("mcap_milestones").upsert(inserts, { onConflict: "mint,threshold_usd", ignoreDuplicates: true }).select("mint, threshold_usd, symbol, status");
  if (error) throw new Error(error.message);
  const done = (data ?? []) as { mint: string; threshold_usd: number; symbol: string | null; status: string }[];
  const crossed = done.filter((r) => r.status === "crossed").map((r) => `${r.symbol ?? r.mint.slice(0, 4)} $${r.threshold_usd / 1e6}M`);
  return { created: done.length, seeded: done.filter((r) => r.status === "seeded").length, crossed, candidates: candidates.length };
}

// ---------- reads ----------

export type RunnerBoard = {
  since: string | null; // oldest row: when the rail went live
  historyHours: number;
  rows: number; // rows in the table (seeded + crossed)
  d1: WindowCounts;
  d7: WindowCounts;
  ledger: RunnerRow[]; // newest crossings first
  generatedAt: string;
};

async function getRunnerBoardImpl(): Promise<RunnerBoard | null> {
  if (process.env.DATA_SOURCE === "fixture") return fixtureBoard();
  const db = getDb();
  if (!db) return null;
  const now = Date.now();
  const at = new Date(now).toISOString();
  const from7 = new Date(now - 7 * 864e5).toISOString();
  const [first, win, count] = await Promise.all([
    db.from("mcap_milestones").select("ts").order("ts", { ascending: true }).limit(1).maybeSingle(),
    db.from("mcap_milestones").select("*").eq("status", "crossed").gte("reached_at", from7).order("reached_at", { ascending: false }).limit(1000),
    db.from("mcap_milestones").select("mint", { count: "exact", head: true }),
  ]);
  if (first.error) throw new Error(first.error.message);
  if (win.error) throw new Error(win.error.message);
  const rows = ((win.data ?? []) as DbRow[]).map(fromDb);
  const mints = [...new Set(rows.map((r) => r.mint))];
  const highest = new Map<string, number>();
  if (mints.length) {
    const all = await chunked(mints, async (part) => {
      const { data, error } = await db.from("mcap_milestones").select("mint, threshold_usd").in("mint", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as { mint: string; threshold_usd: number }[];
    });
    for (const r of all) highest.set(r.mint, Math.max(highest.get(r.mint) ?? 0, r.threshold_usd));
  }
  const since = (first.data as { ts: string } | null)?.ts ?? null;
  return {
    since,
    historyHours: since ? (now - Date.parse(since)) / 3.6e6 : 0,
    rows: count.count ?? 0,
    d1: countWindow(rows, highest, 24, now),
    d7: countWindow(rows, highest, 24 * 7, now),
    ledger: rows.slice(0, 60),
    generatedAt: at,
  };
}
export const getRunnerBoard = memoDb("getRunnerBoard", 120, getRunnerBoardImpl);

export type LaunchCohort = { hours: number; from: string; counts: { line: number; count: number }[]; tokens: CohortToken[]; oldestRead: string | null };

async function getLaunchCohortImpl(hours: number): Promise<LaunchCohort | null> {
  const now = Date.now();
  const from = new Date(now - hours * 3.6e6).toISOString();
  let tokens: CohortToken[];
  if (process.env.DATA_SOURCE === "fixture") {
    const fx = await getTokens({ sort: "marketCap", pageSize: 100 });
    tokens = fx.data.tokens.filter((t) => t.createdAt >= from && peakOf(t.market) >= RUNNER_FLOOR).map((t) => ({ mint: t.mint, symbol: t.symbol, name: t.name, quoteSymbol: t.quote.symbol, createdAt: t.createdAt, peakUsd: peakOf(t.market), lastSeenAt: null }));
  } else {
    const db = getDb();
    if (!db) return null;
    const { data, error } = await db.rpc("runner_cohort", { since: from, min_peak: RUNNER_FLOOR });
    if (error) throw new Error(error.message);
    tokens = ((data ?? []) as { mint: string; symbol: string | null; name: string | null; quote_symbol: string | null; created_at: string; peak_usd: number; last_seen_at: string | null }[]).map((r) => ({
      mint: r.mint, symbol: r.symbol, name: r.name, quoteSymbol: r.quote_symbol, createdAt: r.created_at, peakUsd: r.peak_usd, lastSeenAt: r.last_seen_at,
    }));
  }
  tokens.sort((a, b) => b.peakUsd - a.peakUsd);
  const reads = tokens.map((t) => t.lastSeenAt).filter((x): x is string => !!x).sort();
  return { hours, from, counts: countCohort(tokens), tokens, oldestRead: reads[0] ?? null };
}
export const getLaunchCohort = memoDb("getLaunchCohort", 300, getLaunchCohortImpl);

// Health: table reachable (throws if 0018 is missing), row count, when it went live, newest crossing.
export async function runnersHealth(db: SupabaseClient): Promise<string> {
  const [first, last, count] = await Promise.all([
    db.from("mcap_milestones").select("ts").order("ts", { ascending: true }).limit(1).maybeSingle(),
    db.from("mcap_milestones").select("symbol, threshold_usd, reached_at").eq("status", "crossed").order("reached_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("mcap_milestones").select("mint", { count: "exact", head: true }),
  ]);
  if (first.error) throw new Error(first.error.message);
  const lines = RUNNER_LINES.map((l) => `$${l / 1e6}M`).join(" / ");
  if (!first.data) return `lines ${lines} · not seeded yet (first tick seeds every crossing to date)`;
  const l = last.data as { symbol: string | null; threshold_usd: number; reached_at: string } | null;
  return `lines ${lines} · ${count.count ?? 0} rows since ${(first.data as { ts: string }).ts} · last crossing ${l ? `${l.symbol} $${l.threshold_usd / 1e6}M at ${l.reached_at}` : "none yet"}`;
}

// ---------- fixture ----------

// Offline sample in the RunnerBoard shape, derived from the fixture's tokens (real peaks, invented times):
// crossings are spread over the last 7 days so the page and card render without a DB. Not real data.
async function fixtureBoard(): Promise<RunnerBoard> {
  const now = Date.now();
  const fx = await getTokens({ sort: "marketCap", pageSize: 100 });
  const rows: RunnerRow[] = [];
  const highest = new Map<string, number>();
  fx.data.tokens.forEach((t, i) => {
    if (t.mint === STONK_MINT) return;
    const peak = peakOf(t.market);
    const lines = linesCrossed(peak);
    if (!lines.length) return;
    highest.set(t.mint, lines[lines.length - 1]);
    const reachedAt = new Date(now - ((i * 37) % 160) * 3.6e6 - 600e3).toISOString();
    for (const line of lines) rows.push({ mint: t.mint, thresholdUsd: line, symbol: t.symbol, name: t.name, quoteSymbol: t.quote.symbol, createdAt: t.createdAt, reachedAt, afterTs: new Date(Date.parse(reachedAt) - 300e3).toISOString(), mode: "tick", peakUsd: peak, marketCapUsd: t.market?.marketCapUsd ?? null, status: "crossed" });
  });
  rows.sort((a, b) => (b.reachedAt ?? "").localeCompare(a.reachedAt ?? ""));
  const since = new Date(now - 9 * 864e5).toISOString();
  return { since, historyHours: 9 * 24, rows: rows.length, d1: countWindow(rows, highest, 24, now), d7: countWindow(rows, highest, 168, now), ledger: rows.slice(0, 60), generatedAt: new Date(now).toISOString() };
}
