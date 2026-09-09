import { ImageResponse } from "next/og";
import { AthCard, ATH_CARD_SIZE } from "@/lib/ath-card";
import { cardFonts } from "@/lib/card";
import { getStonkData } from "@/lib/stonk";

// GET /ath-card → 1200×1200 PNG announcing $STONK's all-time-high market cap (StonkFun's
// peakMarketCapUsd), with where it stands now, 24h change, peak vs launch and supply burned.
// Square so it posts cleanly on X and Instagram. Rendered live; nothing is stored.
export const dynamic = "force-dynamic";

export async function GET() {
  const d = await getStonkData();
  const m = d.token.market ?? {};
  if (!m.peakMarketCapUsd) return new Response("peak market cap unavailable", { status: 503 });
  const fonts = await cardFonts();
  return new ImageResponse(
    (
      <AthCard
        peakMarketCapUsd={m.peakMarketCapUsd}
        marketCapUsd={m.marketCapUsd ?? null}
        priceUsd={m.priceUsd ?? null}
        priceChange24h={m.priceChange24h ?? null}
        launchMarketCapUsd={d.launchMarketCapUsd}
        supplyBurnedPct={d.supply.burnedPct}
        at={d.generatedAt}
      />
    ),
    { ...ATH_CARD_SIZE, fonts, headers: { "Cache-Control": "no-store" } }
  );
}
