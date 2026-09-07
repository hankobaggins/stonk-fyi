import { ImageResponse } from "next/og";
import { OG_SUBTITLE, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#0f1012",
          color: "#ffffff",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, color: "#c3c2b7" }}>
          <div style={{ width: 22, height: 22, background: "#3987e5", borderRadius: 5 }} />
          {SITE_NAME}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>$STONK</div>
          <div style={{ fontSize: 38, color: "#c3c2b7", maxWidth: 1000, lineHeight: 1.3 }}>{OG_SUBTITLE}</div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24, color: "#8a8a82" }}>
          <span>stonk.fyi</span><span>·</span>
          <span>data: StonkFun API, Raydium, CoinGecko</span><span>·</span>
          <span>not affiliated with StonkFun</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
