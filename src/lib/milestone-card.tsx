import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import { STONK_LAUNCHED_AT } from "@/lib/stonk";
import { daysBetween, fmtDays } from "@/lib/milestone-math";

// Square (1200×1200) "N% of supply burned" milestone card. Same ledger palette, ring and Geist faces as
// the burn, ATH and buyback cards. Pure: every figure is a prop, so /milestone-card/{pct} (from the stored
// row) and /milestone-card/preview (live) draw the identical image.
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
const stampUtc = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export function MilestoneCard(p: MilestoneCardProps) {
  const at = p.reachedAt ?? p.at;
  const daysLive = Math.floor(daysBetween(STONK_LAUNCHED_AT, at));
  const state = STATE[p.velocitySignal] ?? STATE.info;
  const vel = p.velocityPctDay;
  const velColor = vel === null ? C.ink3 : state.color;
  const lastTook = p.prevReachedAt && p.reachedAt ? fmtDays(daysBetween(p.prevReachedAt, p.reachedAt)) : null;
  const nextIn = vel && vel > 0 ? fmtDays((p.pct + 1 - p.supplyBurnedPct) / vel) : null;

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
        <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>MILESTONE · $STONK · SOLANA</div>
      </div>

      {/* hero: headline left, the ring (the bite is the burned share) right */}
      <div style={{ display: "flex", alignItems: "center", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, ...mono, fontSize: 21 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: `${C.burn}22`, color: C.burn, padding: "9px 16px", borderRadius: 5, fontWeight: 500 }}>
              <div style={{ width: 10, height: 10, borderRadius: 5, background: C.burn }} />
              Burn milestone
            </div>
            <div style={{ display: "flex", color: C.ink2, whiteSpace: "nowrap" }}>{`Supply · on-chain · ${stampUtc(at)}`}</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 40 }}>
            <div style={{ ...mono, display: "flex", fontSize: 300, fontWeight: 500, letterSpacing: -18, lineHeight: 0.85 }}>{p.pct}</div>
            <div style={{ ...mono, display: "flex", fontSize: 120, fontWeight: 500, color: C.ink2, lineHeight: 0.85, marginLeft: 6 }}>%</div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", fontSize: 58, fontWeight: 600, letterSpacing: -2, lineHeight: 1, marginTop: 44 }}>
            <span style={{ color: C.burn }}>$STONK</span>
            <span style={{ marginLeft: 18 }}>supply burned.</span>
          </div>
          <div style={{ display: "flex", ...mono, fontSize: 21, color: C.ink2, marginTop: 30 }}>{`${p.burnedTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} of 1,000,000,000 tokens · ${daysLive} days after launch`}</div>
        </div>
        <div style={{ display: "flex", marginLeft: 24 }}>
          <Ring pct={p.supplyBurnedPct} size={300} stroke={C.accent} track={C.line} width={30} />
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
          {kpi(nextIn ? `BURN VELOCITY · NEXT 1% IN ~${nextIn.toUpperCase()}` : "BURN VELOCITY", vel === null ? num("—", undefined, C.ink3) : num(`${vel > 0.3 ? "▲" : "▽"} ${vel.toFixed(2)}`, "%/day", velColor), true)}
        </div>
      </div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 80, ...mono, fontSize: 17, color: C.ink3 }}>
        <div style={{ display: "flex" }}>Burned share from the on-chain burn ledger · USD at StonkFun pricing · not financial advice</div>
        <div style={{ display: "flex", color: C.accent }}>{SITE_NAME}</div>
      </div>
    </div>
  );
}
