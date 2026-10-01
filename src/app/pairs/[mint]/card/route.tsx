import { ImageResponse } from "next/og";
import { C, cardFonts } from "@/lib/card";
import { OG_SIZE, SITE_NAME } from "@/lib/site";
import { getQuoteAssetDetail } from "@/lib/quote-assets";
import { isStockCategory, ORACLE_LABEL } from "@/lib/quote-math";
import { fmtNum, fmtPrice, fmtUsd } from "@/lib/format";

// GET /pairs/{mint}/card → 1200×630 PNG, the link preview of a quote-asset page (§6m). Rendered live from the same
// read as the page; the page's og:image carries a 5-minute version param so scrapers fetch a fresh render.
export const dynamic = "force-dynamic";

const mono = { fontFamily: "Geist Mono" };

export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  const [d, fonts] = await Promise.all([getQuoteAssetDetail(mint).catch(() => null), cardFonts()]);
  if (!d) return new Response("not a StonkFun quote asset", { status: 404 });
  const sym = d.row.jupSymbol ?? d.pair.symbol;
  const o = isStockCategory(d.row.category) ? d.row.oracle : null;
  const oColor = !o ? C.ink2 : o.state === "247" || o.state === "crypto" ? C.bull : o.state === "proxy" ? C.neutral : C.caution;
  const top = d.coins.slice(0, 3);
  const at = new Date().toISOString().slice(0, 16).replace("T", " ");
  const fig = (label: string, value: string, color: string = C.ink) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8, paddingRight: 20 }}>
      <div style={{ ...mono, fontSize: 15, letterSpacing: 1.5, color: C.ink3 }}>{label}</div>
      <div style={{ ...mono, fontSize: 40, fontWeight: 500, whiteSpace: "nowrap", color }}>{value}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "26px 56px 20px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
          <div style={{ ...mono, fontSize: 13, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 8px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
          <div style={{ ...mono, fontSize: 16, color: C.ink3, marginLeft: "auto" }}>{`QUOTE ASSET · ${d.row.categoryLabel.toUpperCase()}`}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "30px 56px 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1 }}>{`${fmtNum(d.coinsTotal)} ${d.coinsTotal === 1 ? "coin is" : "coins are"} priced in `}</div>
            <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1, color: C.accent }}>{sym}</div>
          </div>
          <div style={{ fontSize: 24, color: C.ink2, marginTop: 14 }}>{`${d.jup?.name ?? d.row.name} · StonkFun coins using it as their unit of account`}</div>

          <div style={{ display: "flex", marginTop: 30, paddingBottom: 22, borderBottom: `1px solid ${C.line}` }}>
            {fig("COINS' 24H VOLUME", fmtUsd(d.shownVolume))}
            {fig(`${sym.toUpperCase()} LIQUIDITY`, fmtUsd(d.row.liquidityUsd))}
            {fig("HOLDERS", fmtNum(d.row.holders))}
            {o ? fig("PRICE AFTER THE CLOSE", o.state === "247" || o.state === "crypto" ? "24/7 feed" : o.state === "proxy" ? "proxy only" : o.state === "hours" ? "none" : "no feed", oColor) : fig("PRICE", fmtPrice(d.row.priceUsd))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 18, gap: 6, ...mono, fontSize: 20, color: C.ink2 }}>
            <div style={{ fontSize: 15, letterSpacing: 1.5, color: C.ink3 }}>MOST TRADED IN IT · 24H VOLUME</div>
            {top.map((c) => (
              <div key={c.mint} style={{ display: "flex", gap: 16 }}>
                <span style={{ color: C.ink, fontWeight: 500, width: 260 }}>{c.symbol}</span>
                <span style={{ width: 180 }}>{fmtUsd(c.volume24hUsd)}</span>
                <span style={{ color: C.ink3 }}>{c.platform ? "launchpad token" : `mcap ${fmtUsd(c.marketCapUsd)}`}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", padding: "18px 56px", borderTop: `1px solid ${C.line}`, ...mono, fontSize: 15, color: C.ink3 }}>
          <div>{`stonk.fyi/pairs · StonkFun · Jupiter · Pyth${o ? ` (${ORACLE_LABEL[o.state]})` : ""}`}</div>
          <div>{`${at} UTC · not financial advice`}</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts, headers: { "Cache-Control": "public, max-age=0, s-maxage=300" } },
  );
}
