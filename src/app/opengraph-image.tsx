import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

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
          <div style={{ fontSize: 44, color: "#c3c2b7" }}>{SITE_TAGLINE}</div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24, color: "#8a8a82" }}>
          <span>supply &amp; burns</span><span>·</span>
          <span>buyback flywheel</span><span>·</span>
          <span>pool depth</span><span>·</span>
          <span>bull-case scorecard</span><span>·</span>
          <span style={{ color: "#c3c2b7" }}>unofficial</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
