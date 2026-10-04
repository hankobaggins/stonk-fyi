import "server-only";
import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { cardFonts } from "@/lib/card";
import { getTokenBurns, STONK_MINT } from "@/lib/api";
import { STONK_INITIAL_SUPPLY } from "@/lib/stonk";
import { communityCardData } from "@/lib/community";
import { COMMUNITY_CARD_SIZE, CommunityCard } from "@/lib/community-card";

// Shared by /community-card and /community-card/{quoteMint} (§6p).
export async function communityCardResponse(req: Request, quote: string | null): Promise<Response> {
  const url = new URL(req.url);
  const burns = await getTokenBurns(STONK_MINT).catch(() => null);
  const at = new Date().toISOString();
  const data = await communityCardData(quote, burns ? (burns.totals.amountTokens / STONK_INITIAL_SUPPLY) * 100 : 0, at);
  if (url.searchParams.get("format") === "json") return NextResponse.json({ generatedAt: at, data }, { status: data ? 200 : quote ? 404 : 503, headers: { "cache-control": "no-store" } });
  if (!data) return new Response(quote ? "no community coins pay holders of this token" : "community mode data unavailable", { status: quote ? 404 : 503 });
  const fonts = await cardFonts();
  return new ImageResponse(<CommunityCard {...data} />, { ...COMMUNITY_CARD_SIZE, fonts, headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
}
