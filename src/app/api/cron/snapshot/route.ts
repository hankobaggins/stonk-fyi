import { NextResponse } from "next/server";
import { getLaunches, getRevenue, getRevenueHistory, getStats, getTokenBurns, getTokens, STONK_MINT } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getPoolInfo, poolSides } from "@/lib/raydium";
import { STONK_POOL } from "@/lib/stonk";
import type { Token } from "@/lib/types";

// Snapshot worker. Invoked by Vercel Cron (see vercel.json) or any scheduler:
//   GET /api/cron/snapshot            -> platform stats, revenue, buybacks, launches, revenue_daily, active tokens
//   GET /api/cron/snapshot?full=1     -> also walks the entire token list (for the long tail; run hourly)
// Protected by CRON_SECRET (Vercel sets the Authorization header automatically).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const full = new URL(req.url).searchParams.get("full") === "1";
  const ts = new Date().toISOString();
  const counts: Record<string, number> = {};
  const errors: string[] = [];
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

  await step("tokens", async () => {
    // Active set: top pages by volume until we hit tokens with zero 24h volume.
    // Full mode: walk every page (12k tokens ≈ 125 requests; fits in the 300/min limit).
    const pageSize = 100;
    let page = 1;
    let written = 0;
    for (;;) {
      const res = await getTokens({ sort: "volume", page, pageSize });
      const toks = res.data.tokens;
      if (!toks.length) break;
      const active = full ? toks : toks.filter((t) => (t.market?.volume24hUsd ?? 0) > 0);
      if (active.length) {
        const { error } = await db.from("tokens").upsert(active.map(tokenRow), { onConflict: "mint" });
        if (error) throw new Error(error.message);
        const { error: e2 } = await db.from("token_snapshots").upsert(active.map((t) => snapshotRow(t, ts)), { onConflict: "mint,ts" });
        if (e2) throw new Error(e2.message);
        written += active.length;
      }
      if (!full && active.length < toks.length) break; // reached the zero-volume tail
      if (page >= res.data.pagination.totalPages) break;
      page++;
    }
    return written;
  });

  return NextResponse.json({ ok: errors.length === 0, ts, full, counts, errors });
}
