import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { getAthAlert } from "@/lib/ath-alerts";
import { AthCard, ATH_CARD_SIZE } from "@/lib/ath-card";
import { cardFonts } from "@/lib/card";
import { getDb } from "@/lib/db";

// GET /ath-card/{id} → 1200×1200 PNG for a stored all-time-high alert (what the worker posted; kept as
// provenance, reproducible from the row). The live card is /ath-card (no id). seeded/quiet rows 404.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const r = await getAthAlert(db, n);
  if (!r || r.status === "seeded" || r.status === "quiet") return NextResponse.json({ error: "not found" }, { status: 404 });

  const fonts = await cardFonts();
  return new ImageResponse(
    (
      <AthCard
        peakMarketCapUsd={r.market_cap_usd}
        marketCapUsd={r.market_cap_usd}
        priceUsd={r.price_usd}
        priceChange24h={r.price_change_24h}
        launchMarketCapUsd={r.launch_mcap_usd ?? 5081}
        supplyBurnedPct={r.supply_burned_pct ?? 0}
        prevHighUsd={r.prev_high_usd}
        at={r.ts}
      />
    ),
    { ...ATH_CARD_SIZE, fonts, headers: { "Cache-Control": "public, max-age=0, s-maxage=86400, immutable" } }
  );
}
