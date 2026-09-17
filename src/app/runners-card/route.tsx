import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { RunnersCard, RUNNERS_CARD_SIZE } from "@/lib/runners-card";
import { cardFonts } from "@/lib/card";
import { getRunnerBoard } from "@/lib/runners";
import { getTokenBurns, STONK_MINT } from "@/lib/api";
import { STONK_INITIAL_SUPPLY } from "@/lib/stonk";

// GET /runners-card?window=7d|24h → 1200×1200 PNG: tokens that crossed each market-cap line inside the
// window, from the crossing ledger (§6k). `?format=json` returns the counts. Rendered live; nothing is
// stored. 503 when the DB is unconfigured or the ledger is not seeded yet. Hand-posted for now.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const window = url.searchParams.get("window") === "24h" ? "24h" : "7d";
  const [board, burns] = await Promise.all([getRunnerBoard().catch(() => null), getTokenBurns(STONK_MINT).catch(() => null)]);
  const at = new Date().toISOString();
  const win = board ? (window === "24h" ? board.d1 : board.d7) : null;
  const live = !!board?.since;
  if (url.searchParams.get("format") === "json") {
    return NextResponse.json({ generatedAt: at, window, since: board?.since ?? null, historyHours: board?.historyHours ?? 0, counts: win }, { status: live ? 200 : 503, headers: { "cache-control": "no-store" } });
  }
  if (!board || !win) return new Response("crossing ledger unavailable", { status: 503 });
  if (!live) return new Response("crossing ledger not seeded yet", { status: 503 });
  const supplyBurnedPct = burns ? (burns.totals.amountTokens / STONK_INITIAL_SUPPLY) * 100 : 0;
  const partial = board.historyHours < win.hours ? board.historyHours : null;
  const fonts = await cardFonts();
  return new ImageResponse(<RunnersCard win={win} supplyBurnedPct={supplyBurnedPct} at={at} partialSinceHours={partial} />, { ...RUNNERS_CARD_SIZE, fonts, headers: { "Cache-Control": "no-store" } });
}
