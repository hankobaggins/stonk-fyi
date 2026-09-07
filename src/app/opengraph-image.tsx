import { ImageResponse } from "next/og";
import { OG_SUBTITLE, SITE_NAME } from "@/lib/site";
import { getStonkData } from "@/lib/stonk";
import { fmtPrice, fmtUsd } from "@/lib/format";

export const alt = `${SITE_NAME} — $STONK metrics, scored live`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const STATE_COLOR: Record<string, string> = { bull: "#37c27e", neutral: "#8fa3a8", bear: "#e0a53c" };

// The social card carries the live tally bar so a share shows the state at that moment,
// caution segments included. Falls back to the static card if upstreams are down.
export default async function OgImage() {
  const d = await getStonkData().catch(() => null);
  const inds = d?.indicators ?? [];
  const bull = inds.filter((i) => i.signal === "bull").length;
  const scored = inds.filter((i) => i.signal !== "info").length;
  const m = d?.token.market ?? {};
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "#0a1317",
          color: "#edf4f5",
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: "#a7babf" }}>
          <svg width="30" height="30" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="7" fill="none" stroke="#1f333b" strokeWidth="4" />
            <circle cx="10" cy="10" r="7" fill="none" stroke="#7cc0d4" strokeWidth="4" strokeDasharray="38.3 5.6" strokeDashoffset="-5.6" transform="rotate(-90 10 10)" />
          </svg>
          {SITE_NAME}
          <span style={{ fontSize: 16, color: "#66797f", border: "1px solid #2c4550", borderRadius: 4, padding: "6px 8px", letterSpacing: 2 }}>UNOFFICIAL</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ fontSize: 96, fontWeight: 600, letterSpacing: -4, lineHeight: 1 }}>$STONK</div>
            {d && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <div style={{ fontSize: 72, letterSpacing: -3, lineHeight: 1 }}>{fmtPrice(m.priceUsd)}</div>
                <div style={{ fontSize: 22, color: "#a7babf", marginTop: 8 }}>{`mcap ${fmtUsd(m.marketCapUsd)} · ${d.supply.burnedPct.toFixed(2)}% burned`}</div>
              </div>
            )}
          </div>
          {d ? (
            <div style={{ display: "flex", alignItems: "center", gap: 28, borderTop: "1px solid #1f333b", borderBottom: "1px solid #1f333b", padding: "22px 0" }}>
              <div style={{ fontSize: 44, lineHeight: 1, display: "flex", alignItems: "baseline" }}>
                {bull}<span style={{ fontSize: 22, color: "#66797f", marginLeft: 10 }}>{`/ ${scored} scored bullish`}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flex: 1, height: 18 }}>
                {inds.map((i) => (
                  <div key={i.key} style={{ flex: 1, borderRadius: 3, background: STATE_COLOR[i.signal] ?? "transparent", border: i.signal === "info" ? "1px dashed #2c4550" : "none" }} />
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 34, color: "#a7babf", maxWidth: 1000, lineHeight: 1.3, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>{OG_SUBTITLE}</div>
          )}
        </div>

        <div style={{ display: "flex", fontSize: 20, color: "#66797f" }}>
          live · source-linked · shows caution states too · data: StonkFun API, Raydium, CoinGecko · not affiliated with StonkFun
        </div>
      </div>
    ),
    { ...size }
  );
}
