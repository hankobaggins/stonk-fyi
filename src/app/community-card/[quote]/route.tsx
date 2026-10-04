import { isWalletAddress } from "@/lib/wallet-rewards-math";
import { communityCardResponse } from "@/lib/community-card-response";

// GET /community-card/{quoteMint} → 1600×900 PNG: what Community Mode coins have sent to holders of that quote token (§6p).
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ quote: string }> }) {
  const { quote } = await ctx.params;
  if (!isWalletAddress(quote)) return new Response("not a mint", { status: 400 });
  return communityCardResponse(req, quote);
}
