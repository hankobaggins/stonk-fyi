import { NextResponse } from "next/server";
import { getLaunches, getPairs, getRevenue, getRevenueHistory, getStats, getStonkPriceHistory, getToken, getTokenBurns, getTokens, STONK_MINT } from "@/lib/api";
import { getPoolInfo } from "@/lib/raydium";
import { getDb } from "@/lib/db";
import { STONK_POOL } from "@/lib/stonk";

// Diagnostics: GET /api/health → per-source status so a broken page can be traced to its upstream.
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { ok: boolean; ms: number; note?: string }> = {};
  const run = async (name: string, fn: () => Promise<string | void>) => {
    const t0 = Date.now();
    try {
      const note = await fn();
      checks[name] = { ok: true, ms: Date.now() - t0, ...(note ? { note } : {}) };
    } catch (e) {
      checks[name] = { ok: false, ms: Date.now() - t0, note: (e as Error).message };
    }
  };

  await Promise.all([
    run("stonkfun:/stats", async () => `${(await getStats()).data.tokens.total} tokens`),
    run("stonkfun:/revenue", async () => `${(await getRevenue()).data.recentBuybacks.length} recent buybacks`),
    run("stonkfun:/revenue/history", async () => `${(await getRevenueHistory()).data.days.length} days`),
    run("stonkfun:/tokens", async () => `${(await getTokens({ pageSize: 1 })).data.pagination.total} total`),
    run("stonkfun:/tokens/STONK", async () => {
      const t = await getToken(STONK_MINT);
      if (!t) throw new Error("404");
      return `price ${t.data.token.market?.priceUsd ?? "missing"}`;
    }),
    run("stonkfun:/tokens/STONK/burns", async () => {
      const b = await getTokenBurns(STONK_MINT);
      return b ? `${b.totals.amountTokens.toFixed(0)} burned` : "null";
    }),
    run("stonkfun:/tokens?quoteMint=STONK", async () => `${(await getTokens({ quoteMint: STONK_MINT, pageSize: 1 })).data.pagination.total} quoted`),
    run("stonkfun:/launches", async () => `${(await getLaunches({ pageSize: 1 })).data.pagination.total} launches`),
    run("stonkfun:/pairs", async () => `${(await getPairs()).length} pairs`),
    run("raydium:pool", async () => {
      const p = await getPoolInfo(STONK_POOL);
      if (!p) throw new Error("null (blocked or shape changed)");
      return `tvl ${p.tvl.toFixed(0)}`;
    }),
    run("coingecko:history", async () => {
      const h = await getStonkPriceHistory(7);
      if (!h) throw new Error("null (blocked, rate-limited, or wrong coin id)");
      return `${h.length} points`;
    }),
    run("supabase", async () => {
      const db = getDb();
      if (!db) return "not configured (optional)";
      const { error, count } = await db.from("platform_snapshots").select("ts", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `${count ?? 0} platform snapshots`;
    }),
  ]);

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, dataSource: process.env.DATA_SOURCE ?? "live", checks }, { status: ok ? 200 : 503 });
}
