import { ImageResponse } from "next/og";
import { cardFonts } from "@/lib/card";
import { getTokenBurns, STONK_MINT } from "@/lib/api";
import { STONK_INITIAL_SUPPLY } from "@/lib/stonk";
import { isWalletAddress } from "@/lib/wallet-rewards-math";
import { coinCardData, loadWalletAgg } from "@/lib/wallet-rewards";
import { COIN_CARD_SIZE, CoinCard } from "@/lib/coin-card";

// GET /rewards-card/{wallet}/coin/{asset}?anon=1 → 1080×1080 PNG: what the held coin(s) paying in reward asset {asset}
// have paid this wallet (§6o gallery). Drawn from the stored scan, never scans. 404 = no such card for this wallet.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ wallet: string; asset: string }> }) {
  const { wallet, asset } = await ctx.params;
  if (!isWalletAddress(wallet) || !isWalletAddress(asset)) return new Response("not a wallet / mint", { status: 400 });
  const anon = new URL(req.url).searchParams.get("anon") === "1";
  const [agg, burns] = await Promise.all([loadWalletAgg(wallet), getTokenBurns(STONK_MINT).catch(() => null)]);
  if (!agg || agg.payouts === 0) return new Response("no rewards on record for this wallet yet", { status: 404 });
  const at = new Date().toISOString();
  const data = await coinCardData(agg, asset, anon, burns ? (burns.totals.amountTokens / STONK_INITIAL_SUPPLY) * 100 : 0, at);
  if (!data) return new Response("this wallet has no card for that reward token", { status: 404 });
  const fonts = await cardFonts();
  return new ImageResponse(<CoinCard {...data} />, { ...COIN_CARD_SIZE, fonts, headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
}
