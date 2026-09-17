import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import { lineLabel, type WindowCounts } from "@/lib/runner-math";

// Square 1200×1200 "runners" card (§6k): how many StonkFun tokens crossed each market-cap line inside a
// window, counted once per token per line, plus the window's biggest runners. Pure: the /runners-card
// route and offline renders draw the same image from the same props. Ledger palette and Geist faces as
// the other cards; bars in the bull colour because a crossing is by definition upward.
export const RUNNERS_CARD_SIZE = { width: 1200, height: 1200 };
export const RUNNERS_CARD_TOP = 4;

export type RunnersCardProps = { win: WindowCounts; supplyBurnedPct: number; at: string; partialSinceHours?: number | null };

const mono = { fontFamily: "Geist Mono" };
const usd = (n: number): string => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : `$${(n / 1e3).toFixed(0)}K`);
const stampUtc = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const windowLabel = (h: number): string => (h === 24 ? "LAST 24H" : h % 24 === 0 ? `LAST ${h / 24}D` : `LAST ${h}H`);
const windowWords = (h: number): string => (h === 24 ? "the last 24 hours" : h % 24 === 0 ? `the last ${h / 24} days` : `the last ${h} hours`);

export function RunnersCard({ win, supplyBurnedPct, at, partialSinceHours }: RunnersCardProps) {
  const entered = win.crossed[0]?.count ?? 0;
  const max = Math.max(1, ...win.crossed.map((c) => c.count));
  const top = win.top.slice(0, RUNNERS_CARD_TOP);

  const line = (c: { line: number; count: number }) => (
    <div key={c.line} style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, flex: 1, borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
        <div style={{ ...mono, display: "flex", width: 190, fontSize: 40, fontWeight: 500, letterSpacing: -1, whiteSpace: "nowrap" }}>{`${lineLabel(c.line)}+`}</div>
        <div style={{ display: "flex", flex: 1, height: 14, background: C.line, borderRadius: 7, alignSelf: "center" }}>
          <div style={{ display: "flex", width: `${c.count ? Math.max(1.5, (c.count / max) * 100) : 0}%`, background: C.bull, borderRadius: 7 }} />
        </div>
        <div style={{ ...mono, display: "flex", width: 120, justifyContent: "flex-end", fontSize: 52, fontWeight: 500, letterSpacing: -2, color: c.count ? C.ink : C.ink3 }}>{c.count}</div>
      </div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 72px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, height: 112, borderBottom: `1px solid ${C.line}` }}>
        <Ring pct={supplyBurnedPct} size={34} stroke={C.accent} track={C.line} width={7} />
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        <div style={{ ...mono, fontSize: 14, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 9px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
        <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>{`${windowLabel(win.hours)} · ${stampUtc(at)}`}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: "44px 0 30px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ ...mono, display: "flex", fontSize: 128, fontWeight: 500, letterSpacing: -6, lineHeight: 1, color: entered ? C.bull : C.ink3 }}>{entered}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 40, fontWeight: 600, letterSpacing: -1.2, lineHeight: 1.1 }}>
            <div style={{ display: "flex" }}>{entered === 1 ? "StonkFun token crossed" : "StonkFun tokens crossed"}</div>
            <div style={{ display: "flex", gap: 14 }}>
              <span style={{ color: C.bull }}>$1M market cap</span>
              <span style={{ color: C.ink2 }}>{`in ${windowWords(win.hours)}`}</span>
            </div>
          </div>
        </div>
        {partialSinceHours ? (
          <div style={{ ...mono, display: "flex", fontSize: 18, color: C.ink3, letterSpacing: 1, marginTop: 22 }}>{`LEDGER LIVE FOR ${Math.round(partialSinceHours)}H · COUNTED SINCE THEN`}</div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "6px 0 8px" }}>{win.crossed.map(line)}</div>

      {top.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "26px 0 24px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ ...mono, display: "flex", fontSize: 17, letterSpacing: 2, color: C.ink3 }}>BIGGEST RUNNERS · PEAK SO FAR</div>
          <div style={{ display: "flex", gap: 28 }}>
            {top.map((r) => (
              <div key={r.mint} style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: -1, whiteSpace: "nowrap", overflow: "hidden" }}>{r.symbol ?? r.mint.slice(0, 6)}</div>
                <div style={{ ...mono, display: "flex", fontSize: 28, fontWeight: 500, color: C.ink2, whiteSpace: "nowrap" }}>{usd(r.peakUsd)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 80, ...mono, fontSize: 17, color: C.ink3 }}>
        <div style={{ display: "flex" }}>market cap at StonkFun pricing · stonk.fyi/runners · not financial advice</div>
        <div style={{ display: "flex", color: C.accent }}>{SITE_NAME}</div>
      </div>
    </div>
  );
}
