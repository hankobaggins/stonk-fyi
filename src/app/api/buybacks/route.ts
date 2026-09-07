import { NextResponse } from "next/server";
import { getRevenue } from "@/lib/api";

export const dynamic = "force-dynamic";

// Lightweight feed for the buyback toasts: the protocol's most recent STONK buybacks.
// Upstream is cached ~30s by getRevenue; clients poll every 20s and dedupe by signature.
export async function GET() {
  try {
    const r = await getRevenue();
    const buybacks = r.data.recentBuybacks.slice(0, 25).map((b) => ({
      signature: b.signature,
      burnSignature: b.burnSignature ?? null,
      symbol: b.quote.symbol,
      spentTokens: b.spentTokens,
      spentValueUsd: b.spentValueUsd,
      boughtTokens: b.boughtTokens,
      boughtAt: b.boughtAt,
    }));
    return NextResponse.json({ generatedAt: new Date().toISOString(), buybacks }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ generatedAt: new Date().toISOString(), buybacks: [] }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
