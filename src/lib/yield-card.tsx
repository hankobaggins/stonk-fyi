import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import type { YieldRow, YieldTable } from "@/lib/yield";

// 1600×900 "who pays holders the most" card: the top 10 coins on the /tokens?mode=reward&by=apr3 ranking, ranked by USD paid to
// holders over one window (3d default, or 24h), with each coin's realized APR beside the payout. Same ledger palette, Geist faces, masthead and footer as the
// square buyback card, laid out for the wide frame: headline + totals down the left, ranking on the right.
// Pure: the /yield-card route and offline renders draw the same image from the same props.
export const YIELD_CARD_SIZE = { width: 1600, height: 900 };
export const YIELD_CARD_TOP = 10;

export type YieldWindow = "24h" | "3d";
export type YieldCardRow = { mint: string; symbol: string; quoteSymbol: string; marketCapUsd: number; apr: number; usd: number; hours: number };
export type YieldBoard = { window: YieldWindow; hours: number; rows: YieldCardRow[]; paying: number; of: number; paidUsd: number };

// Ranks the yield table (getYieldTable) by USD paid to holders over `window`, keeping only rows that have that window. Shared by the
// route's PNG and `?format=json` so both show the same board.
export function yieldBoard(table: YieldTable, window: YieldWindow, top = YIELD_CARD_TOP): YieldBoard {
  const pick = (r: YieldRow) => (window === "24h" ? r.d1 : r.d3);
  const all = table.rows
    .flatMap((r) => {
      const c = pick(r);
      return c ? [{ mint: r.mint, symbol: r.symbol, quoteSymbol: r.quoteSymbol, marketCapUsd: r.marketCapUsd, apr: c.apr, usd: c.usd, hours: c.hours }] : [];
    })
    .sort((a, b) => b.usd - a.usd);
  const rows = all.slice(0, top);
  return { window, hours: window === "24h" ? 24 : 72, rows, paying: all.length, of: table.rows.length, paidUsd: rows.reduce((s, r) => s + r.usd, 0) };
}

export type YieldCardProps = { board: YieldBoard; supplyBurnedPct: number; at: string };

const mono = { fontFamily: "Geist Mono" };

const usd = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};
const pct = (n: number): string => (n >= 1000 ? `${Math.round(n).toLocaleString("en-US")}%` : `${n.toFixed(1)}%`);
const stampUtc = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const windowLabel = (w: YieldWindow): string => (w === "24h" ? "LAST 24H" : "LAST 3D");

export function YieldCard({ board, supplyBurnedPct, at }: YieldCardProps) {
  const rows = board.rows.slice(0, YIELD_CARD_TOP);
  const maxUsd = rows[0]?.usd ?? 0;
  const topApr = Math.max(0, ...rows.map((r) => r.apr));

  // Big figures only, as on the buyback card: no sublines, no per-row detail.
  const kpi = (label: string, value: string, unit?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...mono, display: "flex", fontSize: 17, letterSpacing: 2, color: C.ink3 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
        <div style={{ ...mono, display: "flex", fontSize: 64, fontWeight: 500, letterSpacing: -2.5, lineHeight: 1, whiteSpace: "nowrap" }}>{value}</div>
        {unit && <div style={{ ...mono, display: "flex", fontSize: 20, lineHeight: 1.1, color: C.ink2, whiteSpace: "nowrap" }}>{unit}</div>}
      </div>
    </div>
  );

  const row = (r: YieldCardRow, i: number) => (
    <div key={r.mint} style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, flex: 1, borderBottom: i < rows.length - 1 ? `1px solid ${C.line}` : "none" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <div style={{ ...mono, display: "flex", width: 40, flexShrink: 0, fontSize: 18, color: C.ink3 }}>{String(i + 1).padStart(2, "0")}</div>
        <div style={{ display: "flex", flex: 1, minWidth: 0, fontSize: 30, fontWeight: 600, letterSpacing: -0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.symbol}</div>
        <div style={{ ...mono, display: "flex", width: 120, flexShrink: 0, fontSize: 15, color: C.ink3, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden" }}>{`PAYS ${r.quoteSymbol}`}</div>
        <div style={{ ...mono, display: "flex", width: 150, flexShrink: 0, justifyContent: "flex-end", fontSize: 17, color: C.ink2, whiteSpace: "nowrap" }}>{`${usd(r.marketCapUsd)} MCAP`}</div>
        <div style={{ ...mono, display: "flex", width: 150, flexShrink: 0, justifyContent: "flex-end", fontSize: 21, color: C.bull, whiteSpace: "nowrap" }}>{`${pct(r.apr)} APR`}</div>
        <div style={{ ...mono, display: "flex", width: 140, flexShrink: 0, justifyContent: "flex-end", fontSize: 32, fontWeight: 500, letterSpacing: -1.2, whiteSpace: "nowrap" }}>{usd(r.usd)}</div>
      </div>
      <div style={{ display: "flex", height: 6, background: C.line, borderRadius: 3, marginLeft: 56 }}>
        <div style={{ display: "flex", width: `${maxUsd > 0 ? Math.max(1, (r.usd / maxUsd) * 100) : 0}%`, background: C.accent, borderRadius: 3 }} />
      </div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 72px" }}>
      {/* masthead */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, height: 104, borderBottom: `1px solid ${C.line}` }}>
        <Ring pct={supplyBurnedPct} size={34} stroke={C.accent} track={C.line} width={7} />
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        <div style={{ ...mono, fontSize: 14, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 9px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
        <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>{`${windowLabel(board.window)} · ${stampUtc(at)}`}</div>
      </div>

      <div style={{ display: "flex", flex: 1, gap: 64 }}>
        {/* left: headline + totals */}
        <div style={{ display: "flex", flexDirection: "column", width: 460, padding: "44px 0 28px", borderRight: `1px solid ${C.line}`, paddingRight: 56 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 54, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>
            <span>{`Top ${rows.length} coins`}</span>
            <span>paying holders</span>
            <span style={{ color: C.bull }}>{board.window === "24h" ? "the last 24h" : "the last 3 days"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 40, marginTop: "auto" }}>
            {kpi("TOP APR", pct(topApr), "realized")}
            {kpi("PAID TO HOLDERS", usd(board.paidUsd), `USD · ${board.window === "24h" ? "24H" : "3D"}`)}
            {kpi("COINS PAYING", String(board.paying), `of the ${board.of} largest`)}
          </div>
        </div>

        {/* right: ranking */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "10px 0" }}>{rows.map(row)}</div>
      </div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 76, ...mono, fontSize: 17, color: C.ink3 }}>
        <div style={{ display: "flex" }}>APR = payouts holders received ÷ market cap, annualized · Jupiter prices · a yield estimate, not a promise · not financial advice</div>
        <div style={{ display: "flex", color: C.accent }}>{SITE_NAME}</div>
      </div>
    </div>
  );
}
