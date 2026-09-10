import { NextResponse } from "next/server";
import { getLaunches, getPairs, getRevenue, getRevenueHistory, getStats, getStonkPriceHistory, getToken, getTokenBurns, getTokens, STONK_MINT } from "@/lib/api";
import { getPoolInfo } from "@/lib/raydium";
import { getDb, getHolderWindows, getRewardWindows } from "@/lib/db";
import { BURN_ALERT_THRESHOLD_USD, BURN_ALERT_WINDOW_MIN, recentBurnAlerts } from "@/lib/burn-alerts";
import { latestMilestone } from "@/lib/burn-milestones";
import { ATH_ALERT_COOLDOWN_MIN, highestAth, lastAthPost } from "@/lib/ath-alerts";
import { getGmgnStonk, lastGmgnError } from "@/lib/gmgn";
import { STONK_POOL } from "@/lib/stonk";
import { getRewardCoinsByMcap } from "@/lib/yield";
import { getStockCoinsByMcap, getStockQuoteAssets, trackedMints } from "@/lib/holders";

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
      const { data: last, error } = await db.from("reward_snapshots").select("ts").order("ts", { ascending: false }).limit(1);
      if (error) throw new Error(`${error.message} (migration 0005 applied?)`);
      if (!last?.[0]) return "no readings yet";
      // No count(*) here: it was a 3 s full scan at 1.2M rows and the table is meant to stay small.
      const ageMin = (Date.now() - Date.parse(last[0].ts)) / 60000;
      const note = `last reading ${ageMin.toFixed(0)} min ago`;
      if (ageMin > 15) throw new Error(`${note} — rewards step stalled`);
      return note;
    }),
    run("reward_windows", async () => {
      // The exact call /yield makes, on the coins it shows: fails on a missing 0006 or a timeout.
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const coins = await getRewardCoinsByMcap(100);
      const w = await getRewardWindows(72, coins.map((c) => c.token.mint));
      if (!w) throw new Error("reward_payout_window failed (migration 0006 applied? see server log)");
      let hours = 0;
      for (const x of w.values()) hours = Math.max(hours, x.hours);
      return `${w.size} of ${coins.length} tracked coins have readings, ${hours.toFixed(1)}h of history`;
    }),
    run("holder_snapshots", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const { data: last, error } = await db.from("holder_snapshots").select("ts, kind").order("ts", { ascending: false }).limit(1);
      if (error) throw new Error(`${error.message} (migration 0009 applied?)`);
      if (!last?.[0]) return "no readings yet (first hourly run after 0009 writes them)";
      const ageMin = (Date.now() - Date.parse(last[0].ts)) / 60000;
      const note = `last reading ${ageMin.toFixed(0)} min ago (hourly)`;
      if (ageMin > 75) throw new Error(`${note} — holders step stalled`);
      return note;
    }),
    run("holder_windows", async () => {
      // The exact call /holders makes: fails on a missing 0009 or a timeout.
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const [quotes, coins] = await Promise.all([getStockQuoteAssets(), getStockCoinsByMcap()]);
      const mints = trackedMints(quotes, coins);
      const w = await getHolderWindows(168, mints);
      if (!w) throw new Error("holder_window failed (migration 0009 applied? see server log)");
      let hours = 0;
      for (const x of w.values()) hours = Math.max(hours, x.hours);
      const q = quotes.filter((x) => w.has(x.mint)).length;
      return `${q} of ${quotes.length} quote assets and ${coins.filter((c) => w.has(c.token.mint)).length} of ${coins.length} coins have readings, ${hours.toFixed(1)}h of history`;
    }),
    run("burn_alerts", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const rows = await recentBurnAlerts(db, 1);
      const mode = process.env.SOCIALBU_TOKEN && process.env.SOCIALBU_ACCOUNT_ID ? `posting to SocialBu account ${process.env.SOCIALBU_ACCOUNT_ID}` : "dry-run (SOCIALBU_TOKEN / SOCIALBU_ACCOUNT_ID unset)";
      const last = rows[0] ? `last #${rows[0].id} ${rows[0].status} ${rows[0].amount_tokens.toFixed(0)} STONK at ${rows[0].ts}` : "none yet";
      return `≥$${BURN_ALERT_THRESHOLD_USD} burned (StonkFun pricing) / ${BURN_ALERT_WINDOW_MIN} min · ${mode} · ${last}`;
    }),
    run("burn_milestones", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const last = await latestMilestone(db); // throws if migration 0007 is missing
      const mode = process.env.SOCIALBU_TOKEN && process.env.SOCIALBU_ACCOUNT_ID ? "posting" : "dry-run";
      if (!last) return `every 1% of supply · ${mode} · not seeded yet (first tick seeds the current level)`;
      return `every 1% of supply · ${mode} · last ${last.pct}% ${last.status} at ${last.ts} · next post at ${last.pct + 1}%`;
    }),
    run("ath_alerts", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const [high, post] = await Promise.all([highestAth(db), lastAthPost(db)]); // throws if migration 0008 is missing
      const mode = process.env.SOCIALBU_TOKEN && process.env.SOCIALBU_ACCOUNT_ID ? "posting" : "dry-run";
      if (!high) return `market-cap ATH · ${mode} · not seeded yet (first tick seeds StonkFun's peak)`;
      const bar = `bar $${Math.round(high.market_cap_usd).toLocaleString("en-US")} (${high.status}, ${high.source}) at ${high.ts}`;
      const last = post ? `last post #${post.id} ${post.status} at ${post.ts}` : "no post yet";
      return `market-cap ATH · ${mode} · cooldown ${ATH_ALERT_COOLDOWN_MIN} min · ${bar} · ${last}`;
    }),
  ]);

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, dataSource: process.env.DATA_SOURCE ?? "live", checks }, { status: ok ? 200 : 503 });
}
