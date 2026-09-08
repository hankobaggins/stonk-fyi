import { ImageResponse } from "next/og";
import { C, Ring, cardFonts as fonts } from "@/lib/card";
import { OG_SIZE, OG_SUBTITLE, SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import { getStonkData } from "@/lib/stonk";
import { fmtNum, fmtPrice, fmtUsd } from "@/lib/format";

// Social card. Served from a route (not the opengraph-image file convention) because the
// convention hashes the URL at build time and scrapers cache images by URL, so a share
// showed whichever render X/Telegram/Discord fetched first, sometimes days old. The URL is
// versioned per 5-minute bucket in layout.tsx (`ogImageUrl`), so each window is a new URL.
export const dynamic = "force-dynamic";
const size = OG_SIZE;

const mono = { fontFamily: "Geist Mono" };
const STATE_COLOR: Record<string, string> = { bull: C.bull, neutral: C.neutral, bear: C.caution };

// The social card carries the live tally bar so a share shows the state at that moment,
// caution segments included. Falls back to the static card if upstreams are down.
export async function GET() {
  const [d, fontList] = await Promise.all([getStonkData().catch(() => null), fonts()]);
  const inds = d?.indicators ?? [];
  const bull = inds.filter((i) => i.signal === "bull").length;
  const scored = inds.filter((i) => i.signal !== "info").length;
  const m = d?.token.market ?? {};
  const chg = m.priceChange24h ?? 0;
  const burnedPct = d?.supply.burnedPct ?? 0;
  const lastBurn = d?.burns?.burns[0];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist" }}>
        {/* masthead */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "30px 56px 22px", borderBottom: `1px solid ${C.line}` }}>
          <Ring pct={burnedPct} size={30} stroke={C.accent} track={C.line} width={6} />
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
          <div style={{ ...mono, fontSize: 13, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 8px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
          <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: C.bull }} />
            live
          </div>
        </div>

        {/* ticker */}
        {d && (
          <div style={{ display: "flex", gap: 36, padding: "14px 56px", background: C.surface, borderBottom: `1px solid ${C.line}`, ...mono, fontSize: 18, color: C.ink2 }}>
            <div style={{ display: "flex", gap: 8 }}><span style={{ color: C.ink3 }}>MCAP</span><span style={{ color: C.ink, fontWeight: 500 }}>{fmtUsd(m.marketCapUsd)}</span></div>
            <div style={{ display: "flex", gap: 8 }}><span style={{ color: C.ink3 }}>24H VOL</span><span style={{ color: C.ink, fontWeight: 500 }}>{fmtUsd(m.volume24hUsd)}</span></div>
            <div style={{ display: "flex", gap: 8 }}><span style={{ color: C.ink3 }}>BURNED</span><span style={{ color: C.ink, fontWeight: 500 }}>{`${burnedPct.toFixed(2)}%`}</span></div>
            {lastBurn && <div style={{ display: "flex", gap: 8 }}><span style={{ color: C.ink3 }}>LAST BURN</span><span style={{ color: C.ink, fontWeight: 500 }}>{`${fmtNum(lastBurn.amountTokens)} STONK`}</span></div>}
            {d.pool && <div style={{ display: "flex", gap: 8 }}><span style={{ color: C.ink3 }}>POOL TVL</span><span style={{ color: C.ink, fontWeight: 500 }}>{fmtUsd(d.pool.tvl)}</span></div>}
          </div>
        )}

        {/* hero */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "40px 56px 0" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ ...mono, fontSize: 15, fontWeight: 500, letterSpacing: 2, color: C.ink3, marginBottom: 14 }}>PLATFORM TOKEN · STONKFUN LAUNCHPAD · SOLANA</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
                <div style={{ fontSize: 88, fontWeight: 600, letterSpacing: -4, lineHeight: 1 }}>$STONK</div>
                <div style={{ ...mono, fontSize: 20, fontWeight: 500, color: C.ink2 }}>paired with SPYx</div>
              </div>
            </div>
            {d ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <div style={{ ...mono, fontSize: 84, fontWeight: 500, letterSpacing: -4, lineHeight: 1 }}>{fmtPrice(m.priceUsd)}</div>
                <div style={{ ...mono, fontSize: 20, color: C.ink2, marginTop: 10, display: "flex", gap: 8 }}>
                  <span style={{ color: chg >= 0 ? C.bull : C.down }}>{`${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(1)}%`}</span>
                  <span>24h</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 26, color: C.ink2, maxWidth: 520, lineHeight: 1.3, textAlign: "right" }}>{OG_SUBTITLE}</div>
            )}
          </div>

          {d && (
            <div style={{ display: "flex", alignItems: "center", gap: 28, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, padding: "24px 0", marginTop: 36 }}>
              <div style={{ ...mono, fontSize: 46, fontWeight: 500, lineHeight: 1, display: "flex", alignItems: "baseline", letterSpacing: -2 }}>
                {bull}<span style={{ fontSize: 20, fontWeight: 400, color: C.ink3, marginLeft: 12, letterSpacing: 0 }}>{`/ ${scored} scored bullish`}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flex: 1, height: 20 }}>
                {inds.map((i) => (
                  <div key={i.key} style={{ flex: 1, borderRadius: 3, background: STATE_COLOR[i.signal] ?? "transparent", border: i.signal === "info" ? `1px dashed ${C.lineStrong}` : "none" }} />
                ))}
              </div>
            </div>
          )}

          {d && (
            <div style={{ display: "flex", gap: 28, marginTop: 18, ...mono, fontSize: 17, color: C.ink3 }}>
              {[["bullish", C.bull], ["neutral", C.neutral], ["caution", C.caution]].map(([k, col]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 9 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: col }} />{k}</div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}><div style={{ width: 12, height: 12, borderRadius: 3, border: `1px dashed ${C.lineStrong}` }} />unscored</div>
              <div style={{ marginLeft: "auto", display: "flex" }}>each indicator is scored live and can turn</div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingBottom: 34, ...mono, fontSize: 17, color: C.ink3 }}>
            <div style={{ display: "flex" }}>{SITE_TAGLINE} · shows caution states too · not affiliated with StonkFun</div>
            <div style={{ display: "flex" }}>stonk.fyi</div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fontList,
      // One CDN render per version bucket; scrapers hitting the same URL within the window share it.
      headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" },
    }
  );
}
