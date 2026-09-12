import { NextResponse, after } from "next/server";
import { getDb } from "@/lib/db";
import { runCoinCensus, runWalletCensus } from "@/lib/wallets";

// Wallet census worker (CLAUDE.md §6f). Split out of /api/cron/snapshot on 2026-09-11 because the
// first live run did not fit next to the tick's other steps inside a 300 s function (the caller timed
// out at 280 s with nothing stored). This route has its own 800 s window (Vercel Pro, Fluid compute):
//   GET /api/cron/census          -> 202 at once; the census runs after the response (`after()`),
//                                    up to CENSUS_BUDGET_MS, then stores the run (partial if the budget ran out)
//   GET /api/cron/census?sync=1   -> waits and returns the result JSON (manual runs from the GitHub workflow)
// The snapshot tick fires the async form on the :45 tick every WALLET_CENSUS_EVERY_H hours or with ?census=1.
//   ?kind=coins                   -> the reward-coin census instead (CLAUDE.md §6g, lib/wallets.ts runCoinCensus):
//                                    distinct wallets holding any covered reward coin, per quote asset too.
//                                    Fired daily on the 01:15 UTC tick or with ?census=coins on the snapshot URL.
// Protected by CRON_SECRET.

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const CENSUS_BUDGET_MS = 720_000; // leaves ~80 s of the 800 s window for the DB writes and cold start

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 503 });
  if (!process.env.HELIUS_API_KEY) return NextResponse.json({ error: "HELIUS_API_KEY not set" }, { status: 503 });

  const ts = new Date().toISOString();
  const params = new URL(req.url).searchParams;
  const sync = params.get("sync") === "1";
  const kind = params.get("kind") === "coins" ? "coins" : "quotes";
  const run = async () => {
    if (kind === "coins") {
      const r = await runCoinCensus(db, ts, CENSUS_BUDGET_MS);
      const note = `${r.wallets} wallets across ${r.coins} of ${r.coinsTotal} reward coins (${((r.slotsCovered / Math.max(1, r.slotsTotal)) * 100).toFixed(0)}% of holder-slots)${r.coinsFailed ? ` (${r.coinsFailed} failed: ${r.firstError})` : ""}, ${r.quotes} quote assets, ${r.accounts} accounts, ${(r.durationMs / 1000).toFixed(0)}s`;
      console.log(`coin census ${ts}: ${note}`);
      return { kind, ...r, note };
    }
    const r = await runWalletCensus(db, ts, CENSUS_BUDGET_MS);
    const note = `${r.wallets} wallets across ${r.mintsOk} quote assets${r.mintsFailed ? ` (${r.mintsFailed} failed: ${r.firstError})` : ""}, ${r.accounts} accounts, ${(r.durationMs / 1000).toFixed(0)}s`;
    console.log(`wallet census ${ts}: ${note}`);
    return { kind, ...r, note };
  };

  if (sync) {
    try {
      return NextResponse.json({ ok: true, ...(await run()) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`${kind} census ${ts} failed: ${message}`);
      return NextResponse.json({ ok: false, ts, error: message }, { status: 500 });
    }
  }
  after(async () => {
    try {
      await run();
    } catch (e) {
      console.error(`${kind} census ${ts} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return NextResponse.json({ ok: true, ts, kind, started: true, budget_s: CENSUS_BUDGET_MS / 1000 }, { status: 202 });
}
