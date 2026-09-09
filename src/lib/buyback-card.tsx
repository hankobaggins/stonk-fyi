import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import type { BuybackLeaderboard } from "@/lib/db";

// 1600×900 "who paid for the buybacks" card: the top quote coins by USD spent buying $STONK over a
// window, from the buyback ledger. Pure: the /buyback-card route and offline renders draw the same
// image from the same props. Ledger palette, Geist faces and ring shared with the other cards.
export const BUYBACK_CARD_SIZE = { width: 1600, height: 900 };

export type BuybackCardProps = { board: BuybackLeaderboard; supplyBurnedPct: number; at: string };

const mono = { fontFamily: "Geist Mono" };
const SERIES_1 = "#3987e5"; // --series-1, the one chart color on this card

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
  const rows = board.rows.slice(0, 10);
  const maxShare = rows[0]?.share ?? 0;
  const half = Math.ceil(rows.length / 2);
  const cols = [rows.slice(0, half), rows.slice(half)];

  const kpi = (label: string, value: string, unit?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...mono, display: "flex", fontSize: 15, letterSpacing: 2, color: C.ink3 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <div style={{ ...mono, display: "flex", fontSize: 44, fontWeight: 500, letterSpacing: -1.5, lineHeight: 1, whiteSpace: "nowrap" }}>{value}</div>
        {unit && <div style={{ ...mono, display: "flex", fontSize: 17, lineHeight: 1.1, color: C.ink2, whiteSpace: "nowrap" }}>{unit}</div>}
      </div>
    </div>
  );

  const row = (r: BuybackLeaderboard["rows"][number], i: number) => (
    <div key={r.mint || r.symbol} style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, flex: 1, borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <div style={{ ...mono, display: "flex", width: 34, fontSize: 18, color: C.ink3 }}>{String(i + 1).padStart(2, "0")}</div>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 600, letterSpacing: -0.5, whiteSpace: "nowrap" }}>{r.symbol}</div>
        <div style={{ ...mono, display: "flex", fontSize: 16, color: C.ink3, whiteSpace: "nowrap" }}>{`${count(r.stonkBought)} STONK · ${r.txs} tx`}</div>
        <div style={{ ...mono, display: "flex", marginLeft: "auto", fontSize: 28, fontWeight: 500, letterSpacing: -1, whiteSpace: "nowrap" }}>{usd(r.spentUsd)}</div>
        <div style={{ ...mono, display: "flex", width: 68, justifyContent: "flex-end", fontSize: 16, color: C.ink2 }}>{`${(r.share * 100).toFixed(1)}%`}</div>
      </div>
      <div style={{ display: "flex", height: 6, background: C.line, borderRadius: 3, marginLeft: 48 }}>
        <div style={{ display: "flex", width: `${maxShare > 0 ? Math.max(1, (r.share / maxShare) * 100) : 0}%`, background: SERIES_1, borderRadius: 3 }} />
      </div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 72px" }}>
      {/* masthead */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, height: 96, borderBottom: `1px solid ${C.line}` }}>
        <Ring pct={supplyBurnedPct} size={32} stroke={C.accent} track={C.line} width={6} />
        <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        <div style={{ ...mono, fontSize: 13, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "5px 8px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
        <div style={{ ...mono, fontSize: 17, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>{`$STONK BUYBACKS · ${windowLabel(board.hours)} · ${stampUtc(at)}`}</div>
      </div>

      {/* headline + totals */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "30px 0 26px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1 }}>
            <span>Top {rows.length} coins buying</span>
            <span style={{ color: C.burn, marginLeft: 14 }}>$STONK</span>
          </div>
          <div style={{ ...mono, display: "flex", fontSize: 18, color: C.ink2 }}>{`Fee revenue per quote coin, swept into STONK buybacks and burned · ${board.quotes} coins paid`}</div>
        </div>
        <div style={{ display: "flex", gap: 44, flexShrink: 0 }}>
          {kpi("BOUGHT BACK", usd(board.totalUsd), "USD")}
          {kpi("STONK BOUGHT", count(board.totalStonk))}
          {kpi("BUYBACK TXS", String(board.txs))}
        </div>
      </div>

      {/* two-column table */}
      <div style={{ display: "flex", flex: 1, gap: 64, padding: "6px 0 10px" }}>
        {cols.map((c, ci) => (
          <div key={ci} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            {c.map((r, i) => row(r, ci * half + i))}
          </div>
        ))}
      </div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 68, ...mono, fontSize: 16, color: C.ink3 }}>
        <div style={{ display: "flex" }}>USD at StonkFun pricing at time of buy · stonk.fyi buyback ledger · not financial advice</div>
        <div style={{ display: "flex", color: C.accent }}>{SITE_NAME}</div>
      </div>
    </div>
  );
}
