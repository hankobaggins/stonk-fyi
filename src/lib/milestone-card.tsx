import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import { STONK_LAUNCHED_AT } from "@/lib/stonk";
import { daysBetween, fmtDays } from "@/lib/milestone-math";
import { FIRE_ALERT_THRESHOLD_PCT, VELOCITY_ALERT_THRESHOLD_PCT } from "@/lib/velocity-math";

// Square (1200×1200) "N% of supply burned" milestone card. Same ledger palette, ring and Geist faces as
// the burn, ATH and buyback cards. Pure: every figure is a prop, so /milestone-card/{pct} (from the stored
// row) and /milestone-card/preview (live) draw the identical image. Restyled 2026-09-29 between the original ledger card
// and the burn-velocity cards (owner's call: keep the brand teal): teal glow and ring, the burned share lit in burn
// orange on the ring and on a teal → orange supply gauge, velocity coloured by the velocity cards' tiers.
export const MILESTONE_CARD_SIZE = { width: 1200, height: 1200 };

export type MilestoneCardProps = {
  pct: number;                       // whole percent reached
  supplyBurnedPct: number;           // exact share at render (drives the ring)
  burnedTokens: number;
  burnedValueUsd: number | null;     // lifetime USD at burn, StonkFun pricing
  reachedAt: string | null;          // burn that crossed the line; null when unknown
  prevReachedAt: string | null;      // previous milestone, for "last 1% took"
  velocityPctDay: number | null;
  velocitySignal: "bull" | "neutral" | "bear" | "info" | string;
  at: string;                        // render / detection timestamp
};

const mono = { fontFamily: "Geist Mono" };
const STATE: Record<string, { label: string; color: string }> = {
  bull: { label: "Bullish", color: C.bull },
  neutral: { label: "Neutral", color: C.neutral },
  bear: { label: "Caution", color: C.caution },
  info: { label: "Unscored", color: C.ink3 },
};

const usd = (n: number | null): string => {
  if (n === null || Number.isNaN(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const tokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));

// The brand burn ring with its bite lit: the remaining supply in the teal accent, the burned share in burn orange —
// the same geometry as `Ring` (burned share measured clockwise from 12 o'clock).
function BurnedArc({ pct, size, width }: { pct: number; size: number; width: number }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min(0.99, Math.max(0.01, pct / 100));
  const h = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={h} cy={h} r={r} fill="none" stroke={C.accent} strokeWidth={width} />
      <circle cx={h} cy={h} r={r} fill="none" stroke={C.burn} strokeWidth={width} strokeDasharray={`${c * frac} ${c}`} transform={`rotate(-90 ${h} ${h})`} />
    </svg>
  );
}

export function MilestoneCard(p: MilestoneCardProps) {
  const at = p.reachedAt ?? p.at;
  const daysLive = Math.floor(daysBetween(STONK_LAUNCHED_AT, at));
  const state = STATE[p.velocitySignal] ?? STATE.info;
  const vel = p.velocityPctDay;
  const velColor = vel === null ? C.ink3 : state.color;
  const lastTook = p.prevReachedAt && p.reachedAt ? fmtDays(daysBetween(p.prevReachedAt, p.reachedAt)) : null;
  const nextIn = vel && vel > 0 ? fmtDays((p.pct + 1 - p.supplyBurnedPct) / vel) : null;
  // Velocity tier, same lines and colours as the velocity cards: amber above the heating-up line, orange above on-fire;
  // below it the scorecard's own state colour (never a hard-coded green).
  const tier = vel === null ? null : vel > FIRE_ALERT_THRESHOLD_PCT ? "ON FIRE" : vel > VELOCITY_ALERT_THRESHOLD_PCT ? "HEATING UP" : null;
  const velTierColor = tier === "ON FIRE" ? C.burn : tier === "HEATING UP" ? C.caution : velColor;

  // Gauge: share of the 1B supply burned, 0 → the next multiple of 5 above the next milestone; ticks every 5%,
  // the next whole percent as a dim tick ahead. Fill runs teal → amber → burn orange across the burned share.
  const max = Math.max(25, Math.ceil((p.pct + 1) / 5) * 5 + 5);
  const x = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const heat = `linear-gradient(90deg, ${C.accent} 0%, ${C.accent} 30%, ${C.caution} 72%, ${C.burn} 100%)`;
  const edge = `linear-gradient(90deg, ${C.accent} 0%, ${C.accent} 40%, ${C.caution} 75%, ${C.burn} 100%)`;
  const fives = Array.from({ length: Math.floor(max / 5) - 1 }, (_, i) => (i + 1) * 5);

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
      {/* heat: ember glow behind the headline and ring, hot edge along the top */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 900, display: "flex", backgroundImage: "radial-gradient(ellipse 75% 45% at 50% 38%, rgba(124,192,212,0.11) 0%, rgba(124,192,212,0) 100%)" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 6, display: "flex", backgroundImage: edge }} />

      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 72px" }}>
      {/* masthead */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, height: 112, borderBottom: `1px solid ${C.line}` }}>
        <Ring pct={p.supplyBurnedPct} size={34} stroke={C.accent} track={C.line} width={7} />
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        <div style={{ ...mono, fontSize: 14, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 9px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
        <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>MILESTONE · $STONK · SOLANA</div>
      </div>

      {/* hero: headline left, the ring (the bite is the burned share) right; no badge or subtitle (owner's call 2026-09-10) */}
      <div style={{ display: "flex", alignItems: "center", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <div style={{ ...mono, display: "flex", fontSize: 300, fontWeight: 500, letterSpacing: -18, lineHeight: 0.85, color: C.ink }}>{p.pct}</div>
            <div style={{ ...mono, display: "flex", fontSize: 120, fontWeight: 500, color: C.ink2, lineHeight: 0.85, marginLeft: 6 }}>%</div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", fontSize: 58, fontWeight: 600, letterSpacing: -2, lineHeight: 1, marginTop: 44 }}>
            <span style={{ color: C.burn }}>$STONK</span>
            <span style={{ marginLeft: 18 }}>supply</span>
            <span style={{ marginLeft: 16 }}>burned.</span>
          </div>
          <div style={{ display: "flex", ...mono, fontSize: 21, color: C.ink2, marginTop: 30 }}>{`${p.burnedTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} tokens · ${daysLive} days after launch`}</div>
        </div>
        <div style={{ display: "flex", marginLeft: 24 }}>
          <BurnedArc pct={p.supplyBurnedPct} size={300} width={30} />
        </div>
      </div>

      {/* gauge: supply burned on a 0 → max% scale */}
      <div style={{ display: "flex", flexDirection: "column", marginBottom: 48 }}>
        <div style={{ position: "relative", display: "flex", height: 44 }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 15, height: 14, background: C.surface, borderRadius: 7, display: "flex" }} />
          <div style={{ position: "absolute", left: 0, top: 15, height: 14, width: x(p.supplyBurnedPct), borderRadius: 7, display: "flex", overflow: "hidden" }}>
            <div style={{ width: "100%", height: 14, display: "flex", backgroundImage: heat }} />
          </div>
          {fives.map((v) => <div key={v} style={{ position: "absolute", left: x(v), top: 22, width: 2, height: 14, background: C.lineStrong, display: "flex" }} />)}
          <div style={{ position: "absolute", left: x(p.pct + 1), top: 0, width: 2, height: 44, background: C.ink3, display: "flex" }} />
        </div>
        <div style={{ position: "relative", display: "flex", height: 24, marginTop: 10 }}>
          <div style={{ position: "absolute", left: x(p.pct + 1), top: 0, display: "flex", transform: "translateX(-50%)", ...mono, fontSize: 16, color: C.ink2, letterSpacing: 1, whiteSpace: "nowrap" }}>{`NEXT ${p.pct + 1}%`}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 16, color: C.ink3, letterSpacing: 1, marginTop: 6 }}>
          <div style={{ display: "flex" }}>0% OF SUPPLY</div>
          <div style={{ display: "flex" }}>{`${p.supplyBurnedPct.toFixed(2)}% BURNED · TICKS EVERY 5%`}</div>
          <div style={{ display: "flex" }}>{`${max}%`}</div>
        </div>
      </div>

      {/* stats: 2 × 2, tiles separated by rules */}
      <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", padding: "38px 0", borderBottom: `1px solid ${C.line}` }}>
          {kpi("TOKENS BURNED", num(tokens(p.burnedTokens), "of 1B"))}
          {kpi("USD AT BURN", num(usd(p.burnedValueUsd), "StonkFun pricing"), true)}
        </div>
        <div style={{ display: "flex", padding: "38px 0" }}>
          {kpi("LAST 1% TOOK", lastTook ? num(lastTook) : num("—", "first tracked", C.ink3))}
          {kpi(nextIn ? `BURN VELOCITY · NEXT 1% IN ~${nextIn.toUpperCase()}` : "BURN VELOCITY", vel === null ? num("—", undefined, C.ink3) : num(`${vel > VELOCITY_ALERT_THRESHOLD_PCT ? "▲" : "▽"} ${vel.toFixed(2)}`, tier ? `%/day · ${tier.toLowerCase()}` : "%/day", velTierColor), true)}
        </div>
      </div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 80, ...mono, fontSize: 17, color: C.ink3 }}>
        <div style={{ display: "flex" }}>Burned share from the on-chain burn ledger · USD at StonkFun pricing · not financial advice</div>
        <div style={{ display: "flex", color: C.accent }}>{SITE_NAME}</div>
      </div>
      </div>
    </div>
  );
}
