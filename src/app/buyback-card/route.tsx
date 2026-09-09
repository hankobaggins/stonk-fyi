import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { BuybackCard, BUYBACK_CARD_SIZE, BUYBACK_CARD_TOP } from "@/lib/buyback-card";
import { cardFonts } from "@/lib/card";
import { getBuybackLeaderboard } from "@/lib/db";
import { getTokenBurns, STONK_MINT } from "@/lib/api";
import { STONK_INITIAL_SUPPLY } from "@/lib/stonk";

// GET /buyback-card?hours=1 → 1200×1200 PNG: the top 5 quote coins by USD spent buying $STONK over
// the window, from the buyback ledger in Supabase. `?format=json` returns the numbers behind it.
// Rendered live; nothing is stored. 503 when the DB is unconfigured or the window is empty.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hours = Math.min(168, Math.max(1, Math.round(Number(url.searchParams.get("hours") ?? 1) || 1)));
  const [board, burns] = await Promise.all([getBuybackLeaderboard(hours, BUYBACK_CARD_TOP), getTokenBurns(STONK_MINT).catch(() => null)]);
  const at = new Date().toISOString();
  if (url.searchParams.get("format") === "json") {
    return NextResponse.json({ generatedAt: at, board }, { status: board ? 200 : 503, headers: { "cache-control": "no-store" } });
  }
  if (!board) return new Response("buyback ledger unavailable", { status: 503 });
  if (board.rows.length === 0) return new Response(`no buybacks recorded in the last ${hours}h`, { status: 503 });
  const supplyBurnedPct = burns ? (burns.totals.amountTokens / STONK_INITIAL_SUPPLY) * 100 : 0;
  const fonts = await cardFonts();
  return new ImageResponse(<BuybackCard board={board} supplyBurnedPct={supplyBurnedPct} at={at} />, { ...BUYBACK_CARD_SIZE, fonts, headers: { "Cache-Control": "no-store" } });
}
