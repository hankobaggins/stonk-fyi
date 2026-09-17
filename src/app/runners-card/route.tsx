import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { type CardData, RunnersCard, RUNNERS_CARD_SIZE } from "@/lib/runners-card";
import { cardFonts } from "@/lib/card";
import { getLaunchCohort, getRunnerBoard } from "@/lib/runners";
import { getTokenBurns, STONK_MINT } from "@/lib/api";
import { STONK_INITIAL_SUPPLY } from "@/lib/stonk";

// GET /runners-card?window=7d|24h[&frame=crossed|launched] → 1200×1200 PNG. Default frame "crossed": tokens
// that crossed each market-cap line inside the window, from the crossing ledger (§6k). "launched": tokens
// launched inside the window by the peak they have reached so far (the competitor framing, from the token
// index). `?format=json` returns the counts. Rendered live; nothing is stored. 503 when the DB is
// unconfigured or (crossed) the ledger is not seeded yet. Hand-posted for now.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const window = url.searchParams.get("window") === "24h" ? "24h" : "7d";
  const hours = window === "24h" ? 24 : 24 * 7;
  const frame = url.searchParams.get("frame") === "launched" ? "launched" : "crossed";
  const at = new Date().toISOString();
  const burnsP = getTokenBurns(STONK_MINT).catch(() => null);

  let data: CardData | null = null;
  let partial: number | null = null;
  let why = "";
  if (frame === "launched") {
    const cohort = await getLaunchCohort(hours).catch(() => null);
    if (!cohort) why = "token index unavailable";
    else data = { hours, counts: cohort.counts, top: cohort.tokens.map((t) => ({ mint: t.mint, symbol: t.symbol, peakUsd: t.peakUsd })) };
  } else {
    const board = await getRunnerBoard().catch(() => null);
    if (!board) why = "crossing ledger unavailable";
    else if (!board.since) why = "crossing ledger not seeded yet";
    else {
      const win = window === "24h" ? board.d1 : board.d7;
      data = { hours, counts: win.crossed, top: win.top.map((r) => ({ mint: r.mint, symbol: r.symbol, peakUsd: r.peakUsd })) };
      partial = board.historyHours < hours ? board.historyHours : null;
    }
  }

  if (url.searchParams.get("format") === "json") {
    return NextResponse.json({ generatedAt: at, window, frame, partialSinceHours: partial, ...(data ?? { error: why }) }, { status: data ? 200 : 503, headers: { "cache-control": "no-store" } });
  }
  if (!data) return new Response(why, { status: 503 });
  const burns = await burnsP;
  const supplyBurnedPct = burns ? (burns.totals.amountTokens / STONK_INITIAL_SUPPLY) * 100 : 0;
  const fonts = await cardFonts();
  return new ImageResponse(<RunnersCard data={data} frame={frame} supplyBurnedPct={supplyBurnedPct} at={at} partialSinceHours={partial} />, { ...RUNNERS_CARD_SIZE, fonts, headers: { "Cache-Control": "no-store" } });
}
