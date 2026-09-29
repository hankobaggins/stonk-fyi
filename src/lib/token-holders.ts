import "server-only";
import { unstable_cache } from "next/cache";
import { STONK_MINT } from "./api";
import { getHolderscanToken, HOLDERSCAN_ADVANCED, holderscanEnabled } from "./holderscan";
import { getHolderHistory, PROFILE_EVERY_MIN, readHolderProfile, type HolderHistory, type HolderProfile } from "./stonk-holders";
import type { Token } from "./types";

// HolderScan holder profile on every token page (CLAUDE.md §6l, 2026-09-29). HolderScan now lists a StonkFun token
// within minutes of graduation, so the full profile the home page shows for STONK (§6h) exists for any graduated
// coin. Unlike §6h / §6j this is the one place a page calls HolderScan itself — there are thousands of graduated
// coins and the worker cannot profile them all — so every read is bounded three ways:
//
// 1. Shared cache: one read per mint per TOKEN_HOLDERS_TTL_MIN (default 15) across every viewer and Vercel instance
//    (`unstable_cache`, stale-while-revalidate: a viewer after the window gets the old reading at once and the
//    refresh happens behind them). Failures throw and are never cached.
// 2. Stored first: a mint the worker already profiles in full (STONK every tick) is served from holderscan_snapshots
//    and costs nothing; the worker's partial rows for the top coins (§6j) supply the hourly chart and 24h changes.
// 3. A per-instance unit budget, HOLDERSCAN_PAGE_UNITS_PER_H (default 6,000 on Advanced ≈ 35 fresh token reads an
//    hour; 0 on Standard, whose 200K units a month are spoken for by the worker). Over budget → the block says so and
//    the page is otherwise unaffected. A crawler walking every token page is what this is for.
//
// Not graduated → no call at all (HolderScan lists at graduation). A 404 is remembered per instance for 3 min, so a
// fresh graduate is re-checked often without paying for a miss on every render.
//
// Cost of one read: token details 10 + holders 10 + deltas 20 + breakdowns 50 + stats 20 + pnl 20 +
// wallet-categories 20 + supply-breakdown 20 = 170 units.

export const TOKEN_HOLDERS_TTL_MIN = Math.max(5, Number(process.env.TOKEN_HOLDERS_TTL_MIN ?? 15));
export const TOKEN_PROFILE_UNITS = 170;
export const PAGE_UNITS_PER_H = Math.max(0, Number(process.env.HOLDERSCAN_PAGE_UNITS_PER_H ?? (HOLDERSCAN_ADVANCED ? 6000 : 0)));
const LIVE_DEADLINE_MS = 12_000; // eight paced calls ≈ 3–4 s; the cache still fills if a read outlasts this
const NOT_LISTED_MS = 3 * 60_000;
const NOT_LISTED = "NOT_LISTED";

export type TokenHolders =
  | { state: "ok"; history: HolderHistory; source: "stored" | "live"; synthetic?: boolean }
  | { state: "bonding" }
  | { state: "not-listed"; graduatedAt: string | null }
  | { state: "unavailable"; reason: "disabled" | "budget" | "error"; detail?: string };

// Per-instance accounting, on globalThis so every route bundle in an instance shares it (as the DB breaker does).
type Meter = { hourStart: number; units: number; reads: number; refused: number; lastError: string | null; lastMissing: string | null; lastReadAt: string | null; notListed: Map<string, number> };
const g = globalThis as typeof globalThis & { __hsPageMeter?: Meter };
function meter(): Meter {
  const hour = Math.floor(Date.now() / 3.6e6) * 3.6e6;
  const m = (g.__hsPageMeter ??= { hourStart: hour, units: 0, reads: 0, refused: 0, lastError: null, lastMissing: null, lastReadAt: null, notListed: new Map() });
  if (m.hourStart !== hour) Object.assign(m, { hourStart: hour, units: 0, reads: 0, refused: 0 });
  return m;
}
export function pageMeter() {
  const m = meter();
  return { units: m.units, reads: m.reads, refused: m.refused, lastError: m.lastError, lastMissing: m.lastMissing, lastReadAt: m.lastReadAt, notListed: m.notListed.size };
}

// The cached live read. Keyed by mint only — never pass a per-render value in (it would become the cache key). Top-N
// shares use HolderScan's own supply for the mint (current supply, burns already out), not StonkFun's figures.
const cachedRead = unstable_cache(
  async (mint: string): Promise<string> => {
    const m = meter();
    if (m.units + TOKEN_PROFILE_UNITS > PAGE_UNITS_PER_H) {
      m.refused++;
      throw new Error("BUDGET");
    }
    m.units += TOKEN_PROFILE_UNITS;
    m.reads++;
    const ts = new Date().toISOString();
    const supply = await getHolderscanToken(mint);
    if (!supply.data && supply.error === "not tracked by HolderScan") throw new Error(NOT_LISTED);
    // Sequential and paced, like the worker. The first build fired the six follow-up routes at once and production lost
    // the last three (pnl, wallet-categories, supply-breakdown) on every coin while STONK's sequential worker read had
    // all seven: HolderScan throttles bursts well below the per-minute limit, and the 429 retries fired in lock-step.
    const p = await readHolderProfile(mint, ts, { priceUsd: null, marketCapUsd: null, circulating: supply.data?.supply ?? 0 });
    if (!p) throw new Error(supply.error ?? "HolderScan did not answer for the holder count");
    if (!supply.data) p.errors.push(`supply: ${supply.error}`);
    m.lastReadAt = ts;
    m.lastMissing = p.errors.length ? `${mint.slice(0, 6)}…: ${p.errors.join("; ")}`.slice(0, 300) : null;
    return JSON.stringify(p);
  },
  ["hs-token-profile-v2"], // v2: drops readings cached by the parallel build, which were missing three routes
  { revalidate: TOKEN_HOLDERS_TTL_MIN * 60 },
);

function deadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`HolderScan took longer than ${ms / 1000}s`)), ms))]);
}

// A stored full profile (breakdowns present) younger than this is served as-is.
const STORED_FRESH_MIN = Math.max(30, PROFILE_EVERY_MIN * 2 + 10);

export async function getTokenHolders(t: Token): Promise<TokenHolders> {
  const stored = await getHolderHistory(t.mint).catch(() => null);
  if (stored?.latest.breakdowns && (Date.now() - Date.parse(stored.latest.ts)) / 60000 < STORED_FRESH_MIN) return { state: "ok", history: stored, source: "stored" };
  if (process.env.DATA_SOURCE === "fixture") return stored ? { state: "ok", history: stored, source: "stored" } : fixtureHolders(t);
  if (t.status !== "graduated" && !t.graduatedAt) return { state: "bonding" };
  if (!holderscanEnabled()) return { state: "unavailable", reason: "disabled" };
  const m = meter();
  const miss = m.notListed.get(t.mint);
  if (miss && Date.now() - miss < NOT_LISTED_MS) return { state: "not-listed", graduatedAt: t.graduatedAt ?? null };
  let live: HolderProfile;
  try {
    live = JSON.parse(await deadline(cachedRead(t.mint), LIVE_DEADLINE_MS)) as HolderProfile;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === NOT_LISTED) {
      m.notListed.set(t.mint, Date.now());
      return { state: "not-listed", graduatedAt: t.graduatedAt ?? null };
    }
    if (msg === "BUDGET") return { state: "unavailable", reason: "budget" };
    m.lastError = `${t.symbol}: ${msg}`.slice(0, 200);
    return { state: "unavailable", reason: "error", detail: msg };
  }
  m.notListed.delete(t.mint);
  // The worker's rows for this mint (top coins, §6j) give the hourly chart and the 24h baselines.
  return {
    state: "ok",
    source: "live",
    history: { latest: live, dayAgo: stored?.dayAgo ?? null, weekAgo: stored?.weekAgo ?? null, series: stored?.series ?? [], hoursOfHistory: stored?.hoursOfHistory ?? 0 },
  };
}

// DATA_SOURCE=fixture: a SYNTHETIC profile scaled from the STONK sample by the token's market cap, so the block
// renders offline. Not data; the page labels it.
async function fixtureHolders(t: Token): Promise<TokenHolders> {
  if (t.status !== "graduated" && !t.graduatedAt) return { state: "bonding" };
  const base = await getHolderHistory(STONK_MINT);
  if (!base) return { state: "unavailable", reason: "disabled" };
  const k = Math.min(1, Math.max(0.002, (t.market?.marketCapUsd ?? 0) / (base.latest.marketCapUsd ?? 1)));
  const f = Math.sqrt(k);
  const sc = <T extends Record<string, number | null>>(o: T | null): T | null => (o ? (Object.fromEntries(Object.entries(o).map(([key, v]) => [key, v === null ? null : Math.round(v * f)])) as T) : null);
  const l = base.latest;
  const latest: HolderProfile = {
    ...l,
    mint: t.mint,
    holders: Math.round(l.holders * f),
    deltas: sc(l.deltas),
    breakdowns: sc(l.breakdowns),
    wallets: l.wallets,
    supplyBreakdown: sc(l.supplyBreakdown),
    stats: l.stats ? { ...l.stats, medianPosition: l.stats.medianPosition } : null,
    pnl: l.pnl && t.market?.priceUsd ? { breakEvenPrice: t.market.priceUsd * 0.7, realizedPnlUsd: Math.round((l.pnl.realizedPnlUsd ?? 0) * k), unrealizedPnlUsd: Math.round((l.pnl.unrealizedPnlUsd ?? 0) * k) } : null,
  };
  return { state: "ok", source: "live", synthetic: true, history: { latest, dayAgo: null, weekAgo: null, series: [], hoursOfHistory: 0 } };
}
