import { NextResponse } from "next/server";
import { getRevenue, getTokenBurns, STONK_MINT } from "@/lib/api";

export const dynamic = "force-dynamic";

export type ProtocolEvent = {
  kind: "buyback" | "burn";
  id: string; // buy tx for buybacks, burn tx for other burns
  burnSignature: string | null;
  symbol: string; // fee token spent (buyback) or STONK (burn)
  source: string; // "buyback" | "quote-revenue" | "flywheel" | ...
  spentTokens: number;
  spentValueUsd: number;
  stonk: number; // STONK bought (buyback) or burned (burn)
  at: string;
};

// Feed for the protocol-activity toasts: the protocol's recent STONK buybacks plus its other
// on-chain STONK burns (quote-revenue and flywheel sweeps), which land between buyback
// batches. Buyback burns are excluded from the burn side so an event is never listed twice.
// Upstream is cached ~30s; clients poll every 20s and dedupe by id.
export async function GET() {
  const [rev, burns] = await Promise.all([getRevenue().catch(() => null), getTokenBurns(STONK_MINT, 20).catch(() => null)]);
  if (!rev && !burns) {
    return NextResponse.json({ generatedAt: new Date().toISOString(), events: [] }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const events: ProtocolEvent[] = [];
  for (const b of rev?.data.recentBuybacks.slice(0, 25) ?? []) {
    events.push({ kind: "buyback", id: b.signature, burnSignature: b.burnSignature ?? null, symbol: b.quote.symbol, source: "buyback", spentTokens: b.spentTokens, spentValueUsd: b.spentValueUsd, stonk: b.boughtTokens, at: b.boughtAt });
  }
  for (const e of burns?.burns.slice(0, 25) ?? []) {
    if (e.source === "buyback") continue;
    events.push({ kind: "burn", id: e.signature, burnSignature: e.signature, symbol: "STONK", source: e.source, spentTokens: 0, spentValueUsd: e.valueUsdAtBurn, stonk: e.amountTokens, at: e.burnedAt });
  }
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return NextResponse.json({ generatedAt: new Date().toISOString(), events }, { headers: { "cache-control": "no-store" } });
}
