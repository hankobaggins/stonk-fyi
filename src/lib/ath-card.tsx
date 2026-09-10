import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";

// Square (1200×1200) "new all-time high" card, drawn from the same ledger palette, ring and
// Geist faces as the burn card and the social card. Pure: every figure comes in as a prop so
// the /ath-card route and offline renders produce the identical image.
export const ATH_CARD_SIZE = { width: 1200, height: 1200 };

export type AthCardProps = {
  peakMarketCapUsd: number; // StonkFun's peakMarketCapUsd — the headline
  marketCapUsd: number | null; // where it stands at render time
  priceUsd: number | null;
  priceChange24h: number | null;
  launchMarketCapUsd: number;
  supplyBurnedPct: number;
  prevHighUsd?: number | null; // the high this one broke (worker posts); omitted on the live card
  at: string; // ISO timestamp of the render
};

const mono = { fontFamily: "Geist Mono" };

const usd = (n: number | null | undefined, digits = 2): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: abs >= 1 ? 2 : 0 })}`;
};
const price = (n: number | null): string => (n === null ? "—" : n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}` : `$${n.toFixed(4)}`);
const mult = (n: number): string => (n >= 1000 ? `${Math.round(n).toLocaleString("en-US")}×` : `${n.toFixed(1)}×`);
const stampUtc = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export function AthCard(p: AthCardProps) {
  const change = p.priceChange24h;
  const changeColor = change === null ? C.ink3 : change >= 0 ? C.bull : C.down;
  const changeText = change === null ? "—" : `${change >= 0 ? "▲" : "▽"} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
  const fromPeak = p.marketCapUsd !== null ? ((p.marketCapUsd - p.peakMarketCapUsd) / p.peakMarketCapUsd) * 100 : null;
  const atPeak = fromPeak !== null && fromPeak > -1;
  const nowLine = p.marketCapUsd === null ? "" : atPeak ? ` · now ${usd(p.marketCapUsd)}` : ` · now ${usd(p.marketCapUsd)} (${fromPeak!.toFixed(1)}% from peak)`;
  const prevGain = p.prevHighUsd ? ((p.peakMarketCapUsd - p.prevHighUsd) / p.prevHighUsd) * 100 : null;
  const subLine = p.prevHighUsd
    ? `Peak at StonkFun pricing · previous high ${usd(p.prevHighUsd)}${prevGain !== null && prevGain >= 0.05 ? ` (+${prevGain.toFixed(1)}%)` : ""}`
    : `Peak at StonkFun pricing${nowLine}`;

  // Number + smaller unit on a shared baseline (Satori needs explicit line-height on both).
  const num = (value: string, unit?: string, color = C.ink, size = 56) => (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
      <div style={{ ...mono, display: "flex", fontSize: size, fontWeight: 500, letterSpacing: -size / 32, lineHeight: 1, color, whiteSpace: "nowrap" }}>{value}</div>
      {unit && <div style={{ ...mono, display: "flex", fontSize: 22, lineHeight: 1.1, color: C.ink2, whiteSpace: "nowrap" }}>{unit}</div>}
    </div>
  );
  const kpi = (label: string, value: React.ReactNode, left = false) => (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, gap: 20, padding: left ? "0 0 0 36px" : "0 36px 0 0", ...(left ? { borderLeft: `1px solid ${C.line}` } : {}) }}>
      <div style={{ ...mono, display: "flex", fontSize: 18, letterSpacing: 2, color: C.ink3 }}>{label}</div>
      {value}
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 72px" }}>
      {/* masthead */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, height: 112, borderBottom: `1px solid ${C.line}` }}>
        <Ring pct={p.supplyBurnedPct} size={34} stroke={C.accent} track={C.line} width={7} />
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        <div style={{ ...mono, fontSize: 14, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 9px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
        <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>ATH · $STONK · SOLANA</div>
      </div>

      {/* hero */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, ...mono, fontSize: 21 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: `${C.bull}22`, color: C.bull, padding: "9px 16px", borderRadius: 5, fontWeight: 500 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: C.bull }} />
            All-time high
          </div>
          <div style={{ display: "flex", color: C.ink2 }}>{`Market cap · ${stampUtc(p.at)}`}</div>
        </div>
        <div style={{ display: "flex", ...mono, fontSize: 212, fontWeight: 500, letterSpacing: -12, lineHeight: 1, marginTop: 40 }}>{usd(p.peakMarketCapUsd)}</div>
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 58, fontWeight: 600, letterSpacing: -2, lineHeight: 1, marginTop: 30 }}>
          <span style={{ color: C.burn }}>$STONK</span>
          <span style={{ marginLeft: 18 }}>all-time high.</span>
        </div>
        <div style={{ display: "flex", ...mono, fontSize: 21, color: C.ink2, marginTop: 30 }}>{subLine}</div>
      </div>

      {/* stats: 2 × 2, tiles separated by rules */}
      <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", padding: "38px 0", borderBottom: `1px solid ${C.line}` }}>
          {kpi("PRICE NOW", num(price(p.priceUsd), "USD"))}
          {kpi("24H CHANGE", num(changeText, undefined, changeColor), true)}
        </div>
        <div style={{ display: "flex", padding: "38px 0" }}>
          {kpi("PEAK VS LAUNCH", num(mult(p.peakMarketCapUsd / p.launchMarketCapUsd), `from ${usd(p.launchMarketCapUsd, 0)}`))}
          {kpi("SUPPLY BURNED", num(`${p.supplyBurnedPct.toFixed(2)}%`, "of 1B"), true)}
        </div>
      </div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 80, ...mono, fontSize: 17, color: C.ink3 }}>
        <div style={{ display: "flex" }}>USD at StonkFun pricing · SPYx-denominated pool · not financial advice</div>
        <div style={{ display: "flex", color: C.accent }}>{SITE_NAME}</div>
      </div>
    </div>
  );
}
