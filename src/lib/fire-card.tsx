import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import { fmtDays } from "@/lib/milestone-math";
import { fmtSince } from "@/lib/velocity-math";

// Square (1200×1200) "burns are on fire" card — the second tier of the burn-velocity rail (§6n), posted when the
// rolling 4h burn rate crosses FIRE_ALERT_THRESHOLD_PCT (0.5%/day). Same frame as the "heating up" card
// (lib/velocity-card.tsx) so the two read as one series; the heat is carried by the burn orange, the flame and the
// gauge's heat gradient. Pure: every figure is a prop, so /fire-card/{id} and /fire-card/preview draw the same image.
export const FIRE_CARD_SIZE = { width: 1200, height: 1200 };

export type FireCardProps = {
  pctDay: number;                    // burn velocity now, % of supply / day
  thresholdPct: number;              // the on-fire line (0.5)
  heatingPct: number;                // the heating-up / bullish line (0.3), drawn on the gauge for context
  prevPctDay: number | null;         // velocity at the previous transition of this rail
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

// Two-tone flame, drawn (not an emoji: next/og would fetch emoji glyphs from a CDN at render time).
// Exported for the heating-up card, which draws the same flame in its own colours.
export function Flame({ size, outer = C.burn, inner = C.caution }: { size: number; outer?: string; inner?: string }) {
  return (
    <svg width={size * 0.8} height={size} viewBox="0 0 64 80">
      <path d="M32 2 C35 16 50 24 54 42 C58 60 47 78 32 78 C17 78 6 66 10 48 C12 38 18 32 22 25 C22 33 25 38 29 41 C27 28 28 14 32 2 Z" fill={outer} />
      <path d="M33 36 C35 47 45 52 45 62 C45 71 39 77 32 77 C25 77 19 71 20 63 C21 56 26 52 28 46 C30 51 32 53 34 54 C32 48 32 42 33 36 Z" fill={inner} />
    </svg>
  );
}

export function FireCard(p: FireCardProps) {
  const fire = p.pctDay > p.thresholdPct;
  const hero = fire ? C.burn : C.ink;
  const hours = p.windowHours ?? 4;
  const span = Math.abs(hours - Math.round(hours)) < 0.05 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
  const next = Math.floor(p.supplyBurnedPct) + 1;
  const nextIn = p.pctDay > 0 ? fmtDays((next - p.supplyBurnedPct) / p.pctDay) : null;
  const since = p.prevTs ? fmtSince(p.prevTs, p.at) : null;

  // Gauge: 0 → max; the heating-up and on-fire lines as ticks, the previous reading as a grey mark.
  const max = Math.max(1, p.pctDay * 1.25, (p.prevPctDay ?? 0) * 1.25);
  const x = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  // Heat gradient keyed to the gauge: green at 0, amber at the heating-up line, full burn orange from the on-fire line.
  const heat = `linear-gradient(90deg, ${C.bull} 0%, ${C.caution} ${x(p.heatingPct)}, ${C.burn} ${x(p.thresholdPct)}, ${C.burn} 100%)`;
  const edge = `linear-gradient(90deg, ${C.bull} 0%, ${C.caution} 30%, ${C.burn} 60%, ${C.burn} 100%)`;
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
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", position: "relative" }}>
      {/* heat: a faint ember glow behind the headline and a hot edge along the top */}
      {fire && <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 900, display: "flex", backgroundImage: "radial-gradient(ellipse 70% 45% at 30% 40%, rgba(217,89,38,0.16) 0%, rgba(217,89,38,0) 100%)" }} />}
      {fire && <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 6, display: "flex", backgroundImage: edge }} />}

      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 72px" }}>
        {/* masthead */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, height: 112, borderBottom: `1px solid ${C.line}` }}>
          <Ring pct={p.supplyBurnedPct} size={34} stroke={C.accent} track={C.line} width={7} />
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
          <div style={{ ...mono, fontSize: 14, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 9px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
          <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>BURN VELOCITY · $STONK · SOLANA</div>
        </div>

        {/* hero: flame + the rate, burn orange when above the on-fire line (the colour follows the state) */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <div style={{ display: "flex", marginRight: 22, marginBottom: 8 }}>{fire ? <Flame size={150} /> : <div style={{ ...mono, display: "flex", fontSize: 96, color: C.neutral }}>▽</div>}</div>
            <div style={{ ...mono, display: "flex", fontSize: 250, fontWeight: 500, letterSpacing: -14, lineHeight: 0.85, color: hero }}>{p.pctDay.toFixed(2)}</div>
            <div style={{ ...mono, display: "flex", fontSize: 64, fontWeight: 500, color: C.ink2, lineHeight: 0.85, marginLeft: 16, marginBottom: 6 }}>%/day</div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", fontSize: 58, fontWeight: 600, letterSpacing: -2, lineHeight: 1, marginTop: 44 }}>
            <span style={{ color: C.burn }}>$STONK</span>
            <span style={{ marginLeft: 18 }}>burns are</span>
            <span style={{ marginLeft: 16, color: fire ? C.burn : C.ink }}>on fire.</span>
          </div>
          <div style={{ display: "flex", ...mono, fontSize: 21, color: C.ink2, marginTop: 30 }}>
            {`${tokens(p.windowTokens)} tokens burned in the last ${span} · ${usd(p.windowUsd)} at StonkFun pricing · ${p.windowBurns ?? "—"} burns`}
          </div>

          {/* gauge: heat gradient fill, clipped to the reading */}
          <div style={{ display: "flex", flexDirection: "column", marginTop: 56 }}>
            <div style={{ position: "relative", display: "flex", height: 44 }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: 15, height: 14, background: C.surface, borderRadius: 7, display: "flex" }} />
              <div style={{ position: "absolute", left: 0, top: 15, height: 14, width: x(p.pctDay), borderRadius: 7, display: "flex", overflow: "hidden" }}>
                <div style={{ width: 1056, height: 14, display: "flex", backgroundImage: heat }} />
              </div>
              {tickLine(p.heatingPct, C.caution)}
              {tickLine(p.thresholdPct, C.burn)}
              {p.prevPctDay !== null && <div style={{ position: "absolute", left: x(p.prevPctDay), top: 9, width: 6, height: 26, background: C.ink2, borderRadius: 3, transform: "translateX(-50%)", display: "flex" }} />}
            </div>
            <div style={{ position: "relative", display: "flex", height: 24, marginTop: 10 }}>
              {tickLabel(p.heatingPct, `HEATING UP ${p.heatingPct.toFixed(1)}`, C.caution)}
              {tickLabel(p.thresholdPct, `ON FIRE ABOVE ${p.thresholdPct.toFixed(1)}`, C.burn)}
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
            {kpi("ANNUALIZED", num(`${(p.pctDay * 365).toFixed(0)}%`, "of supply a year", fire ? C.burn : C.ink), true)}
          </div>
        </div>

        {/* footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 80, ...mono, fontSize: 17, color: C.ink3 }}>
          <div style={{ display: "flex" }}>{`Rolling ${span} burn rate, on-chain ledger · USD at StonkFun pricing · not financial advice`}</div>
          <div style={{ display: "flex", color: C.accent }}>{SITE_NAME}</div>
        </div>
      </div>
    </div>
  );
}
