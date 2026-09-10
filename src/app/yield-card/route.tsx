import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { YieldCard, YIELD_CARD_SIZE, yieldBoard, type YieldWindow } from "@/lib/yield-card";
import { cardFonts } from "@/lib/card";
import { getYieldTable } from "@/lib/yield";
import { getTokenBurns, STONK_MINT } from "@/lib/api";
import { STONK_INITIAL_SUPPLY } from "@/lib/stonk";

// GET /yield-card?window=3d|24h → 1600×900 PNG: the top 5 coins on the /yield table by realized holder-fee
// APR over the window (3d default: the 72h average is the steadier figure). `?format=json` returns the board.
// Rendered live; nothing is stored. 503 when the DB is unconfigured, still collecting, or no coin has the window.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const window: YieldWindow = url.searchParams.get("window") === "24h" ? "24h" : "3d";
  const [table, burns] = await Promise.all([getYieldTable(), getTokenBurns(STONK_MINT).catch(() => null)]);
  const at = table.generatedAt;
  const board = table.status === "ok" ? yieldBoard(table, window) : null;
  if (url.searchParams.get("format") === "json") {
    return NextResponse.json({ generatedAt: at, status: table.status, board }, { status: board?.rows.length ? 200 : 503, headers: { "cache-control": "no-store" } });
  }
  if (!board) return new Response(`yield table unavailable (${table.status})`, { status: 503 });
  if (board.rows.length === 0) return new Response(`no coin has a full ${window} payout window yet`, { status: 503 });
  const supplyBurnedPct = burns ? (burns.totals.amountTokens / STONK_INITIAL_SUPPLY) * 100 : 0;
  const fonts = await cardFonts();
  return new ImageResponse(<YieldCard board={board} supplyBurnedPct={supplyBurnedPct} at={at} />, { ...YIELD_CARD_SIZE, fonts, headers: { "Cache-Control": "no-store" } });
}
