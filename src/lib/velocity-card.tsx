import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import { fmtDays } from "@/lib/milestone-math";
import { fmtSince } from "@/lib/velocity-math";

// Square (1200×1200) "burns are heating up" card, posted when burn velocity crosses the bullish line.
// Same ledger palette, ring and Geist faces as the burn, milestone and ATH cards. Pure: every figure is a prop,
// so /velocity-card/{id} (from the stored row) and /velocity-card/preview (live) draw the identical image.
export const VELOCITY_CARD_SIZE = { width: 1200, height: 1200 };

export type VelocityCardProps = {
  pctDay: number;                    // burn velocity now, % of supply / day
  thresholdPct: number;              // the bullish line (0.3)
  rearmPct: number;                  // the re-arm level (0.2)
  prevPctDay: number | null;         // velocity at the previous transition
  prevTs: string | null;
  windowHours: number | null;
  windowTokens: number | null;
  windowUsd: number | null;          // at StonkFun's value-at-burn
  windowBurns: number | null;
  tokensPerHour: number | null;
  supplyBurnedPct: number;
  at: string;                        // detection / render timestamp
};

const mono = { fontFamily: "Geist Mono" };
const usd = (n: number | null): string => {
  if (n === null || Number.isNaN(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const tokens = (n: number | null): string => (n === null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));

export function VelocityCard(p: VelocityCardProps) {
  const hot = p.pctDay > p.thresholdPct;
  const hours = p.windowHours ?? 4;
  const span = Math.abs(hours - Math.round(hours)) < 0.05 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
  const next = Math.floor(p.supplyBurnedPct) + 1;
  const nextIn = p.pctDay > 0 ? fmtDays((next - p.supplyBurnedPct) / p.pctDay) : null;
  const since = p.prevTs ? fmtSince(p.prevTs, p.at) : null;

  // Gauge: 0 → max on one rail; the bullish line and the re-arm level as ticks, the previous reading as a grey mark.
  const max = Math.max(0.6, p.pctDay * 1.25, (p.prevPctDay ?? 0) * 1.25);
  const x = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const tickLine = (v: number, color: string) => <div style={{ position: "absolute", left: x(v), top: 0, width: 2, height: 44, background: color, display: "flex" }} />;
  const tickLabel = (v: number, label: string, color: string) => (
    <div style={{ position: "absolute", left: x(v), top: 0, display: "flex", transform: "translateX(-50%)", ...mono, fontSize: 16, color, letterSpacing: 1, whiteSpace: "nowrap" }}>{label}</div>
  );

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
        <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>BURN VELOCITY · $STONK · SOLANA</div>
      </div>

      {/* hero: the rate as the headline, state-colored (bull when above the line, never hard-coded) */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ ...mono, display: "flex", fontSize: 96, fontWeight: 500, color: hot ? C.bull : C.neutral, lineHeight: 1, marginRight: 24, marginBottom: 22 }}>{hot ? "▲" : "▽"}</div>
          <div style={{ ...mono, display: "flex", fontSize: 250, fontWeight: 500, letterSpacing: -14, lineHeight: 0.85, color: hot ? C.bull : C.ink }}>{p.pctDay.toFixed(2)}</div>
          <div style={{ ...mono, display: "flex", fontSize: 64, fontWeight: 500, color: C.ink2, lineHeight: 0.85, marginLeft: 16, marginBottom: 6 }}>%/day</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 58, fontWeight: 600, letterSpacing: -2, lineHeight: 1, marginTop: 44 }}>
          <span style={{ color: C.burn }}>$STONK</span>
          <span style={{ marginLeft: 18 }}>burns are heating up.</span>
        </div>
        <div style={{ display: "flex", ...mono, fontSize: 21, color: C.ink2, marginTop: 30 }}>
          {`${tokens(p.windowTokens)} tokens burned in the last ${span} · ${usd(p.windowUsd)} at StonkFun pricing · ${p.windowBurns ?? "—"} burns`}
        </div>

        {/* gauge */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 56 }}>
          <div style={{ position: "relative", display: "flex", height: 44 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 15, height: 14, background: C.surface, borderRadius: 7, display: "flex" }} />
            <div style={{ position: "absolute", left: 0, top: 15, height: 14, width: x(p.pctDay), background: hot ? C.bull : C.neutral, borderRadius: 7, display: "flex" }} />
            {tickLine(p.rearmPct, C.ink3)}
            {tickLine(p.thresholdPct, C.caution)}
            {p.prevPctDay !== null && <div style={{ position: "absolute", left: x(p.prevPctDay), top: 9, width: 6, height: 26, background: C.ink2, borderRadius: 3, transform: "translateX(-50%)", display: "flex" }} />}
          </div>
          <div style={{ position: "relative", display: "flex", height: 24, marginTop: 10 }}>
            {tickLabel(p.rearmPct, `RE-ARM ${p.rearmPct.toFixed(1)}`, C.ink3)}
            {tickLabel(p.thresholdPct, `BULLISH ABOVE ${p.thresholdPct.toFixed(1)}`, C.caution)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 16, color: C.ink3, letterSpacing: 1, marginTop: 6 }}>
            <div style={{ display: "flex" }}>0 %/DAY</div>
            <div style={{ display: "flex" }}>{p.prevPctDay !== null ? `GREY MARK · PREVIOUS READING ${p.prevPctDay.toFixed(2)}` : ""}</div>
            <div style={{ display: "flex" }}>{`${max.toFixed(2)} %/DAY`}</div>
          </div>
        </div>
      </div>

      {/* stats: 2 × 2, tiles separated by rules */}
      <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", padding: "38px 0", borderBottom: `1px solid ${C.line}` }}>
          {kpi("UP FROM", p.prevPctDay === null ? num("—", "first tracked", C.ink3) : num(`${p.prevPctDay.toFixed(2)}`, since ? `%/day · ${since} ago` : "%/day"))}
          {kpi("BURNED PER HOUR", num(tokens(p.tokensPerHour), `STONK · ${span} window`), true)}
        </div>
        <div style={{ display: "flex", padding: "38px 0" }}>
          {kpi(nextIn ? `SUPPLY BURNED · NEXT 1% IN ~${nextIn.toUpperCase()}` : "SUPPLY BURNED", num(`${p.supplyBurnedPct.toFixed(2)}%`, "of 1B"))}
          {kpi("ANNUALIZED", num(`${(p.pctDay * 365).toFixed(0)}%`, "of supply a year", hot ? C.bull : C.ink), true)}
        </div>
      </div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 80, ...mono, fontSize: 17, color: C.ink3 }}>
        <div style={{ display: "flex" }}>{`Rolling ${span} burn rate, on-chain ledger · USD at StonkFun pricing · not financial advice`}</div>
        <div style={{ display: "flex", color: C.accent }}>{SITE_NAME}</div>
      </div>
    </div>
  );
}
