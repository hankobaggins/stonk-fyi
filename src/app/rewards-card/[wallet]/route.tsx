import { ImageResponse } from "next/og";
import { cardFonts } from "@/lib/card";
import { getTokenBurns, STONK_MINT } from "@/lib/api";
import { STONK_INITIAL_SUPPLY } from "@/lib/stonk";
import { isWalletAddress } from "@/lib/wallet-rewards-math";
import { loadWalletAgg, viewOf } from "@/lib/wallet-rewards";
import { cardDataOf, REWARDS_CARD_SIZE, RewardsBreakdownCard, RewardsTotalCard } from "@/lib/rewards-card";

// GET /rewards-card/{wallet}?kind=total|breakdown&anon=1 → 1600×900 PNG of a wallet's StonkFun holder rewards (§6o),
// drawn from the stored scan (never scans: crawlers fetch this for link previews). The page's og:image is the total
// card with a 5-minute `v` bucket so a re-share shows fresh figures. 404 = never scanned or never paid.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  if (!isWalletAddress(wallet)) return new Response("not a wallet", { status: 400 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "breakdown" ? "breakdown" : "total";
  const anon = url.searchParams.get("anon") === "1";
  const [agg, burns] = await Promise.all([loadWalletAgg(wallet), getTokenBurns(STONK_MINT).catch(() => null)]);
  if (!agg || agg.payouts === 0) return new Response("no rewards on record for this wallet yet — check it at /rewards/" + wallet, { status: 404 });
  const at = new Date().toISOString();
  const view = await viewOf(agg, at);
  const data = cardDataOf(view, burns ? (burns.totals.amountTokens / STONK_INITIAL_SUPPLY) * 100 : 0, anon, at);
  const fonts = await cardFonts();
  const el = kind === "breakdown" ? <RewardsBreakdownCard {...data} /> : <RewardsTotalCard {...data} />;
  return new ImageResponse(el, { ...REWARDS_CARD_SIZE, fonts, headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
}
