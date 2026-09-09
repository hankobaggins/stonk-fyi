import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import type { BuybackLeaderboard } from "@/lib/db";

// Square 1200×1200 "who paid for the buybacks" card: the top 5 quote coins by USD spent buying $STONK over a
// window, from the buyback ledger. Pure: the /buyback-card route and offline renders draw the same
// image from the same props. Ledger palette, Geist faces and ring shared with the other cards.
export const BUYBACK_CARD_SIZE = { width: 1200, height: 1200 };
export const BUYBACK_CARD_TOP = 5;

export type BuybackCardProps = { board: BuybackLeaderboard; supplyBurnedPct: number; at: string };

const mono = { fontFamily: "Geist Mono" };

const usd = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};
const count = (n: number): string => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};
const stampUtc = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const windowLabel = (h: number): string => (h === 1 ? "LAST HOUR" : h < 48 ? `LAST ${h}H` : `LAST ${Math.round(h / 24)}D`);

export function BuybackCard({ board, supplyBurnedPct, at }: BuybackCardProps) {
  const rows = board.rows.slice(0, BUYBACK_CARD_TOP);
  const maxShare = rows[0]?.share ?? 0;

  // Big figures only (owner's call, 2026-09-09): no sublines, no per-row detail.
  const kpi = (label: string, value: string, unit?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
      <div style={{ ...mono, display: "flex", fontSize: 17, letterSpacing: 2, color: C.ink3 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
        <div style={{ ...mono, display: "flex", fontSize: 64, fontWeight: 500, letterSpacing: -2.5, lineHeight: 1, whiteSpace: "nowrap" }}>{value}</div>
        {unit && <div style={{ ...mono, display: "flex", fontSize: 20, lineHeight: 1.1, color: C.ink2, whiteSpace: "nowrap" }}>{unit}</div>}
      </div>
    </div>
  );

  const row = (r: BuybackLeaderboard["rows"][number], i: number) => (
    <div key={r.mint || r.symbol} style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, flex: 1, borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
        <div style={{ ...mono, display: "flex", width: 44, fontSize: 24, color: C.ink3 }}>{String(i + 1).padStart(2, "0")}</div>
        <div style={{ display: "flex", fontSize: 52, fontWeight: 600, letterSpacing: -1.5, whiteSpace: "nowrap" }}>{r.symbol}</div>
        <div style={{ ...mono, display: "flex", marginLeft: "auto", fontSize: 52, fontWeight: 500, letterSpacing: -2, whiteSpace: "nowrap" }}>{usd(r.spentUsd)}</div>
        <div style={{ ...mono, display: "flex", width: 110, justifyContent: "flex-end", fontSize: 24, color: C.ink2 }}>{`${(r.share * 100).toFixed(1)}%`}</div>
      </div>
      <div style={{ display: "flex", height: 10, background: C.line, borderRadius: 5, marginLeft: 66 }}>
        <div style={{ display: "flex", width: `${maxShare > 0 ? Math.max(1, (r.share / maxShare) * 100) : 0}%`, background: C.bull, borderRadius: 5 }} />
      </div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 72px" }}>
      {/* masthead */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, height: 112, borderBottom: `1px solid ${C.line}` }}>
        <Ring pct={supplyBurnedPct} size={34} stroke={C.accent} track={C.line} width={7} />
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        <div style={{ ...mono, fontSize: 14, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 9px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
        <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>{`${windowLabel(board.hours)} · ${stampUtc(at)}`}</div>
      </div>

      {/* headline */}
      <div style={{ display: "flex", alignItems: "baseline", fontSize: 64, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1, padding: "44px 0 36px" }}>
        <span>{`Top ${rows.length} coins buying`}</span>
        <span style={{ color: C.burn, marginLeft: 18 }}>$STONK</span>
      </div>

      {/* totals */}
      <div style={{ display: "flex", gap: 32, padding: "0 0 34px", borderBottom: `1px solid ${C.line}` }}>
        {kpi("BOUGHT BACK", usd(board.totalUsd), "USD")}
        {kpi("STONK BOUGHT", count(board.totalStonk))}
        {kpi("BUYBACK TXS", String(board.txs))}
      </div>

      {/* ranking */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "8px 0 12px" }}>{rows.map(row)}</div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 80, ...mono, fontSize: 17, color: C.ink3 }}>
        <div style={{ display: "flex" }}>USD at StonkFun pricing at time of buy · stonk.fyi buyback ledger · not financial advice</div>
        <div style={{ display: "flex", color: C.accent }}>{SITE_NAME}</div>
      </div>
    </div>
  );
}
