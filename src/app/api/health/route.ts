import { NextResponse } from "next/server";
import { getLaunches, getPairs, getRevenue, getRevenueHistory, getStats, getStonkPriceHistory, getToken, getTokenBurns, getTokens, STONK_MINT } from "@/lib/api";
import { getPoolInfo } from "@/lib/raydium";
import { getDb } from "@/lib/db";
import { BURN_ALERT_THRESHOLD_USD, BURN_ALERT_WINDOW_MIN, recentBurnAlerts } from "@/lib/burn-alerts";
import { getGmgnStonk, lastGmgnError } from "@/lib/gmgn";
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
    run("gmgn:token", async () => {
      if (!process.env.GMGN_API_KEY) return "skipped (GMGN_API_KEY unset)";
      const g = await getGmgnStonk();
      if (!g) throw new Error(lastGmgnError ?? "null (cached failure; retry in ~1 min)");
      return `${g.holderCount} holders, price ${g.priceUsd}`;
    }),
    run("supabase", async () => {
      const db = getDb();
      if (!db) return "not configured (optional)";
      const { error, count } = await db.from("platform_snapshots").select("ts", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      const { data: latest } = await db.from("platform_snapshots").select("ts").order("ts", { ascending: false }).limit(1);
      const lastTs = latest?.[0]?.ts as string | undefined;
      if (!lastTs) return `${count ?? 0} platform snapshots, none yet`;
      const ageMin = (Date.now() - Date.parse(lastTs)) / 60000;
      const note = `${count ?? 0} platform snapshots, last ${ageMin.toFixed(0)} min ago`;
      // The tick runs every 5 min; anything past 15 min means the trigger has stalled (see CLAUDE.md §6).
      if (ageMin > 15) throw new Error(`${note} — snapshot tick stalled`);
      return note;
    }),
    run("reward_snapshots", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const { error, count } = await db.from("reward_snapshots").select("ts", { count: "exact", head: true });
      if (error) throw new Error(`${error.message} (migration 0005 applied?)`);
      const { data: first } = await db.from("reward_snapshots").select("ts").order("ts", { ascending: true }).limit(1);
      const { data: last } = await db.from("reward_snapshots").select("ts").order("ts", { ascending: false }).limit(1);
      if (!first?.[0] || !last?.[0]) return `${count ?? 0} rows, none yet`;
      const hours = (Date.parse(last[0].ts) - Date.parse(first[0].ts)) / 3.6e6;
      return `${count ?? 0} rows, ${hours.toFixed(1)}h of history, last ${((Date.now() - Date.parse(last[0].ts)) / 60000).toFixed(0)} min ago`;
    }),
    run("burn_alerts", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const rows = await recentBurnAlerts(db, 1);
      const mode = process.env.SOCIALBU_TOKEN && process.env.SOCIALBU_ACCOUNT_ID ? `posting to SocialBu account ${process.env.SOCIALBU_ACCOUNT_ID}` : "dry-run (SOCIALBU_TOKEN / SOCIALBU_ACCOUNT_ID unset)";
      const last = rows[0] ? `last #${rows[0].id} ${rows[0].status} ${rows[0].amount_tokens.toFixed(0)} STONK at ${rows[0].ts}` : "none yet";
      return `≥$${BURN_ALERT_THRESHOLD_USD} burned (StonkFun pricing) / ${BURN_ALERT_WINDOW_MIN} min · ${mode} · ${last}`;
    }),
  ]);

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, dataSource: process.env.DATA_SOURCE ?? "live", checks }, { status: ok ? 200 : 503 });
}
