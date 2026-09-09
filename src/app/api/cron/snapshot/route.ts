import { NextResponse } from "next/server";
import { getLaunches, getRevenue, getRevenueHistory, getRewards, getStats, getToken, getTokenBurns, getTokens, STONK_MINT } from "@/lib/api";
import { getDb } from "@/lib/db";
import { runBurnAlert } from "@/lib/burn-alerts";
import { getGmgnStonk } from "@/lib/gmgn";
import { getPoolInfo, poolSides } from "@/lib/raydium";
import { getStonkData, STONK_POOL } from "@/lib/stonk";
import type { Token } from "@/lib/types";

// Snapshot worker. Invoked by the GitHub Actions tick (.github/workflows/snapshot.yml) every 5 min,
// with ?hourly=1 at the top of each hour, and by Vercel Cron (vercel.json) once a day with ?full=1:
//   GET /api/cron/snapshot            -> platform stats, revenue, buybacks, launches, revenue_daily, STONK + top 100 tokens by volume
//   GET /api/cron/snapshot?hourly=1   -> same, but top 500 tokens
//   GET /api/cron/snapshot?full=1     -> walks the entire token list, then prunes non-STONK snapshots older than 30 days
//   ...&dry=1                         -> the burn_alert step records the alert but never posts to X
// Cadence is tiered to keep token_snapshots small enough for Supabase's free tier (~8 MB/day).
// Protected by CRON_SECRET.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SNAPSHOT_RETENTION_DAYS = 30;

function tokenRow(t: Token) {
  return {
    mint: t.mint,
    pool: t.pool ?? null,
    name: t.name,
    symbol: t.symbol,
    quote_mint: t.quote.mint,
    quote_symbol: t.quote.symbol,
    quote_category: t.quote.category ?? null,
    creator: t.creator ?? null,
    launchpad: t.launchpad ?? null,
    mode: t.mode ?? null,
    transfer_fee_bps: t.transferFee?.bps ?? null,
    image_url: t.imageUrl ?? null,
    status: t.status,
    created_at: t.createdAt,
    graduated_at: t.graduatedAt ?? null,
    last_seen_at: new Date().toISOString(),
    raw: t,
  };
}

function snapshotRow(t: Token, ts: string) {
  return {
    mint: t.mint,
    ts,
    price_usd: t.market?.priceUsd ?? null,
    market_cap_usd: t.market?.marketCapUsd ?? null,
    volume_24h_usd: t.market?.volume24hUsd ?? null,
    liquidity_usd: t.market?.liquidityUsd ?? null,
    price_change_24h: t.market?.priceChange24h ?? null,
    status: t.status,
    graduation_progress: t.graduationProgress ?? null,
  };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 503 });

  const params = new URL(req.url).searchParams;
  const full = params.get("full") === "1";
  const hourly = params.get("hourly") === "1";
  const dry = params.get("dry") === "1";
  const maxPages = full ? Infinity : hourly ? 5 : 1;
  const ts = new Date().toISOString();
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const notes: Record<string, string> = {};
  const step = async (name: string, fn: () => Promise<number>) => {
    try {
      counts[name] = await fn();
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  };

  await step("platform", async () => {
    const [stats, revenue] = await Promise.all([getStats(), getRevenue()]);
    const s = stats.data;
    const r = revenue.data;
    const { error } = await db.from("platform_snapshots").insert({
      ts,
      tokens_total: s.tokens.total,
      tokens_graduated: s.tokens.graduated,
      tokens_about_to_grad: s.tokens.aboutToGraduate,
      reward_launches: s.tokens.rewardLaunches,
      total_market_cap_usd: s.tokens.totalMarketCapUsd,
      total_volume_24h_usd: s.tokens.totalVolume24hUsd,
      total_revenue_usd: r.revenue.totalRevenueUsd,
      total_buyback_usd: r.revenue.totalBuybackUsd,
      bought_back_tokens: r.revenue.boughtBackTokens,
      buyback_count: r.revenue.buybackCount,
      burn_value_usd: r.burns.totalValueUsdAtBurn,
      burn_count: r.burns.burnCount,
      raw: { stats: s, revenue: { ...r, recentBuybacks: undefined } },
    });
    if (error) throw new Error(error.message);

    const bb = r.recentBuybacks.map((b) => ({
      signature: b.signature,
      burn_signature: b.burnSignature ?? null,
      quote_mint: b.quote.mint,
      quote_symbol: b.quote.symbol,
      spent_tokens: b.spentTokens,
      spent_value_usd: b.spentValueUsd,
      bought_tokens: b.boughtTokens,
      bought_value_usd: b.boughtValueUsd,
      bought_at: b.boughtAt,
    }));
    if (bb.length) {
      const { error: e2 } = await db.from("buybacks").upsert(bb, { onConflict: "signature", ignoreDuplicates: false });
      if (e2) throw new Error(e2.message);
    }
    return 1 + bb.length;
  });

  await step("revenue_daily", async () => {
    const h = await getRevenueHistory();
    const rows = h.data.days.map((d) => ({
      day: d.date,
      revenue_usd: d.dailyRevenue,
      holders_revenue_usd: d.dailyHoldersRevenue,
      protocol_revenue_usd: d.dailyProtocolRevenue,
      updated_at: ts,
    }));
    const { error } = await db.from("revenue_daily").upsert(rows, { onConflict: "day" });
    if (error) throw new Error(error.message);
    return rows.length;
  });

  await step("launches", async () => {
    const l = await getLaunches({ pageSize: 100 });
    const rows = l.data.launches.map((x) => ({
      mint: x.mint,
      pool: x.pool ?? null,
      name: x.name,
      symbol: x.symbol,
      creator: x.creator ?? null,
      quote_mint: x.quote.mint,
      quote_symbol: x.quote.symbol,
      launchpad: x.launchpad ?? null,
      mode: x.mode ?? null,
      transfer_fee_bps: x.transferFee?.bps ?? null,
      start_mcap_usd: x.startMarketCapUsd ?? null,
      created_at: x.createdAt,
    }));
    const { error } = await db.from("launches").upsert(rows, { onConflict: "mint" });
    if (error) throw new Error(error.message);
    return rows.length;
  });

  await step("stonk_burns", async () => {
    const b = await getTokenBurns(STONK_MINT);
    if (!b) return 0;
    const rows = b.burns.map((x) => ({
      signature: x.signature,
      mint: STONK_MINT,
      amount_tokens: x.amountTokens,
      value_usd_at_burn: x.valueUsdAtBurn,
      source: x.source,
      burned_at: x.burnedAt,
    }));
    if (!rows.length) return 0;
    const { error } = await db.from("token_burns").upsert(rows, { onConflict: "signature" });
    if (error) throw new Error(error.message);
    return rows.length;
  });

  await step("burn_alert", async () => {
    // ≥ BURN_ALERT_THRESHOLD STONK burned inside the last BURN_ALERT_WINDOW_MIN minutes (minus burns
    // already announced) → /burn-card/{id} rendered and posted to X via SocialBu. See src/lib/burn-alerts.ts.
    const d = await getStonkData();
    const burns = d.burns?.burns ?? [];
    if (!burns.length) return 0;
    const v = d.indicators.find((i) => i.key === "burnrate");
    const r = await runBurnAlert(db, burns, {
      supplyBurnedPct: d.supply.burnedPct,
      velocityPctDay: d.burnRate?.pctSupplyPerDay ?? null,
      velocitySignal: v?.signal ?? "info",
      priceUsd: d.token.market?.priceUsd ?? null,
    }, { dry });
    if (r.alertId) notes.burn_alert = `#${r.alertId} ${r.status}`;
    return r.created;
  });

  await step("pool", async () => {
    const p = await getPoolInfo(STONK_POOL);
    if (!p) return 0;
    const sides = poolSides(p, STONK_MINT);
    const { error } = await db.from("pool_snapshots").insert({
      pool_id: p.id,
      ts,
      stonk_reserve: sides.stonkReserve,
      quote_reserve: sides.quoteReserve,
      quote_symbol: sides.quote.symbol,
      price_quote: p.price,
      tvl_usd: p.tvl,
      volume_24h_usd: p.day?.volume ?? null,
    });
    if (error) throw new Error(error.message);
    return 1;
  });

  await step("rewards", async () => {
    // Lifetime payouts per reward coin, for coins that paid inside the last 7 days (~50 rows a tick).
    // /yield turns the 24h / 72h deltas into a realized holder-fee APR (src/lib/yield.ts).
    const r = await getRewards();
    const cutoff = Date.now() - 7 * 864e5;
    const rows = r.data.launches
      .filter((l) => l.payoutCount > 0 && l.lastPayoutAt && Date.parse(l.lastPayoutAt) >= cutoff)
      .map((l) => ({ mint: l.mint, ts, quote_mint: l.quote.mint, distributed_tokens: l.distributedTokens, payout_count: l.payoutCount, holder_count: l.holderCount }));
    if (!rows.length) return 0;
    const { error } = await db.from("reward_snapshots").upsert(rows, { onConflict: "mint,ts" });
    if (error) throw new Error(error.message);
    return rows.length;
  });

  await step("gmgn", async () => {
    // Skipped (0 rows) when GMGN_API_KEY is unset. One request bundle per tick, well inside GMGN's limit.
    const g = await getGmgnStonk();
    if (!g) return 0;
    const { error } = await db.from("gmgn_snapshots").insert({
      ts,
      price_usd: g.priceUsd,
      holder_count: g.holderCount,
      top10_holder_rate: g.top10HolderRate,
      smart_wallets: g.wallets.smart,
      kol_wallets: g.wallets.kol,
      whale_wallets: g.wallets.whale,
      buy_volume_24h_usd: g.vol24h.buyUsd,
      sell_volume_24h_usd: g.vol24h.sellUsd,
      buys_24h: g.vol24h.buys,
      sells_24h: g.vol24h.sells,
      liquidity_usd: g.liquidityUsd,
    });
    if (error) throw new Error(error.message);
    return 1;
  });

  await step("tokens", async () => {
    // Top pages by volume (1 page normally, 5 hourly); full mode walks every page
    // (16k tokens ≈ 165 requests; fits in the 300/min limit). STONK itself is always included.
    const pageSize = 100;
    let page = 1;
    let written = 0;
    const seen = new Set<string>();
    const write = async (toks: Token[]) => {
      const fresh = toks.filter((t) => !seen.has(t.mint));
      if (!fresh.length) return;
      fresh.forEach((t) => seen.add(t.mint));
      const { error } = await db.from("tokens").upsert(fresh.map(tokenRow), { onConflict: "mint" });
      if (error) throw new Error(error.message);
      const { error: e2 } = await db.from("token_snapshots").upsert(fresh.map((t) => snapshotRow(t, ts)), { onConflict: "mint,ts" });
      if (e2) throw new Error(e2.message);
      written += fresh.length;
    };
    for (;;) {
      const res = await getTokens({ sort: "volume", page, pageSize });
      const toks = res.data.tokens;
      if (!toks.length) break;
      await write(full ? toks : toks.filter((t) => (t.market?.volume24hUsd ?? 0) > 0));
      if (page >= maxPages || page >= res.data.pagination.totalPages) break;
      page++;
    }
    if (!seen.has(STONK_MINT)) {
      const s = await getToken(STONK_MINT);
      if (s) await write([s.data.token]);
    }
    return written;
  });

  if (full) {
    await step("prune", async () => {
      const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 864e5).toISOString();
      const { error, count } = await db.from("token_snapshots").delete({ count: "exact" }).lt("ts", cutoff).neq("mint", STONK_MINT);
      if (error) throw new Error(error.message);
      return count ?? 0;
    });
  }

  return NextResponse.json({ ok: errors.length === 0, ts, mode: full ? "full" : hourly ? "hourly" : "tick", counts, notes, errors });
}
