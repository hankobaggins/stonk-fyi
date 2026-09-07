import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { OG_SUBTITLE, SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import { getStonkData } from "@/lib/stonk";
import { fmtNum, fmtPrice, fmtUsd } from "@/lib/format";

export const alt = `${SITE_NAME}: ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// Ledger palette, mirrored from globals.css (next/og can't read CSS variables).
const C = { bg: "#0a1317", surface: "#101c21", line: "#1f333b", lineStrong: "#2c4550", ink: "#edf4f5", ink2: "#a7babf", ink3: "#66797f", accent: "#7cc0d4", bull: "#37c27e", neutral: "#8fa3a8", caution: "#e0a53c", down: "#ef6b6b", burn: "#d95926" };
const STATE_COLOR: Record<string, string> = { bull: C.bull, neutral: C.neutral, bear: C.caution };

const FONT_DIR = path.join(process.cwd(), "node_modules/geist/dist/fonts");
async function fonts() {
  const [sans, sansSemi, mono, monoMed] = await Promise.all([
    readFile(path.join(FONT_DIR, "geist-sans/Geist-Regular.ttf")),
    readFile(path.join(FONT_DIR, "geist-sans/Geist-SemiBold.ttf")),
    readFile(path.join(FONT_DIR, "geist-mono/GeistMono-Regular.ttf")),
    readFile(path.join(FONT_DIR, "geist-mono/GeistMono-Medium.ttf")),
  ]);
  return [
    { name: "Geist", data: sans, weight: 400 as const, style: "normal" as const },
    { name: "Geist", data: sansSemi, weight: 600 as const, style: "normal" as const },
    { name: "Geist Mono", data: mono, weight: 400 as const, style: "normal" as const },
    { name: "Geist Mono", data: monoMed, weight: 500 as const, style: "normal" as const },
  ];
}

// The burn ring at OG scale: the bite is the burned share of supply.
function Ring({ pct, size, stroke, track, width }: { pct: number; size: number; stroke: string; track: string; width: number }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min(0.95, Math.max(0.04, pct / 100));
  const h = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={h} cy={h} r={r} fill="none" stroke={track} strokeWidth={width} />
      <circle cx={h} cy={h} r={r} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={`${c * (1 - frac)} ${c * frac}`} strokeDashoffset={-c * frac} transform={`rotate(-90 ${h} ${h})`} />
    </svg>
  );
}

const mono = { fontFamily: "Geist Mono" };

// The social card carries the live tally bar so a share shows the state at that moment,
// caution segments included. Falls back to the static card if upstreams are down.
export default async function OgImage() {
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
    { ...size, fonts: fontList }
  );
}
