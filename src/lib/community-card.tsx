import { C, Ring } from "@/lib/card";
import { Logo } from "@/lib/coin-card";
import { SITE_NAME } from "@/lib/site";

// Share cards for StonkFun Community Mode (§6p, hand-posted): what community coins have sent to the holders of their
// quote token. kind "quote" = one quote asset ("Holders of USELESS have been sent $X by N community coins", top coins
// on the right); kind "all" = every quote asset (top quote assets on the right). 1600×900 like the rewards cards, so X
// shows them uncropped. Pure: the /community-card routes and offline renders draw the same image.
export const COMMUNITY_CARD_SIZE = { width: 1600, height: 900 };
export const COMMUNITY_CARD_ROWS = 5;

export type CommunityCardRow = { key: string; label: string; sub?: string | null; image?: string | null; usd: number | null };
export type CommunityCardData = {
  kind: "quote" | "all";
  quote: { mint: string; symbol: string; image?: string | null } | null;
  usd: number;               // sent to quote-token holders, USD at the last repricing
  tokens: number | null;     // the same in the quote token (kind "quote")
  coinHoldersUsd: number | null;
  coins: number;
  active: number;
  quoteAssets: number;       // kind "all"
  shareBps: number;
  firstAt: string | null;
  rows: CommunityCardRow[];  // ranked by usd
  restCount: number;
  restUsd: number;
  supplyBurnedPct: number;
  at: string;
  synthetic?: boolean;
};

const mono = { fontFamily: "Geist Mono" };
const fmtUsd = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e5) return `$${(n / 1e3).toFixed(1)}K`;
  if (a >= 10) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
};
const fmtAmt = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  if (a >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toPrecision(3);
};
const day = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const daysSince = (a: string, b: string): number => Math.max(1, Math.ceil((Date.parse(b) - Date.parse(a)) / 86_400_000));
const pct = (bps: number) => `${+(bps / 100).toFixed(2)}%`;

export function CommunityCard(p: CommunityCardData) {
  const total = fmtUsd(p.usd);
  const heroSize = total.length <= 6 ? 190 : total.length <= 7 ? 168 : total.length <= 8 ? 150 : 128;
  const maxUsd = Math.max(1e-9, ...p.rows.map((r) => r.usd ?? 0));
  const sym = p.quote?.symbol ?? "";
  const headSize = sym.length <= 8 ? 56 : sym.length <= 12 ? 48 : 40;

  const kpi = (label: string, value: string, sub: string | null) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
      <div style={{ ...mono, display: "flex", fontSize: 16, letterSpacing: 2, color: C.ink3, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ ...mono, display: "flex", fontSize: 44, fontWeight: 500, letterSpacing: -1.6, lineHeight: 1, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ ...mono, display: "flex", fontSize: 17, color: C.ink2, whiteSpace: "nowrap" }}>{sub ?? " "}</div>
    </div>
  );

  const row = (r: CommunityCardRow, i: number) => (
    <div key={r.key} style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, height: 124, flexShrink: 0, borderBottom: i < p.rows.length - 1 || p.restCount ? `1px solid ${C.line}` : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ ...mono, display: "flex", width: 32, flexShrink: 0, fontSize: 18, color: C.ink3 }}>{String(i + 1).padStart(2, "0")}</div>
        <Logo src={r.image} label={r.label} mint={r.key} size={48} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 600, letterSpacing: -0.8, whiteSpace: "nowrap", overflow: "hidden" }}>{r.label}</div>
          {r.sub && <div style={{ ...mono, display: "flex", fontSize: 15, color: C.ink3, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden" }}>{r.sub}</div>}
        </div>
        <div style={{ ...mono, display: "flex", width: 170, flexShrink: 0, justifyContent: "flex-end", fontSize: 34, fontWeight: 500, letterSpacing: -1.2, whiteSpace: "nowrap", color: r.usd === null ? C.ink3 : C.ink }}>{r.usd === null ? "unpriced" : fmtUsd(r.usd)}</div>
      </div>
      <div style={{ display: "flex", height: 6, background: C.line, borderRadius: 3, marginLeft: 48 }}>
        <div style={{ display: "flex", width: `${Math.max(1, ((r.usd ?? 0) / maxUsd) * 100)}%`, background: C.accent, borderRadius: 3 }} />
      </div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 72px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, height: 104, borderBottom: `1px solid ${C.line}` }}>
        <Ring pct={p.supplyBurnedPct} size={34} stroke={C.accent} track={C.line} width={7} />
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        <div style={{ ...mono, fontSize: 14, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 9px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
        <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>{`STONKFUN COMMUNITY MODE${p.synthetic ? " · SAMPLE DATA" : ""}`}</div>
      </div>

      <div style={{ display: "flex", flex: 1, gap: 56 }}>
        {/* left: who was paid, the number, three figures */}
        <div style={{ display: "flex", flexDirection: "column", width: 760, padding: "44px 56px 36px 0", borderRight: `1px solid ${C.line}` }}>
          {p.kind === "quote" && p.quote ? (
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <Logo src={p.quote.image} label={p.quote.symbol} mint={p.quote.mint} size={84} ring={C.lineStrong} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: 30, fontWeight: 600, letterSpacing: -0.8, color: C.ink2 }}>Holders of</div>
                <div style={{ display: "flex", fontSize: headSize, fontWeight: 600, letterSpacing: -2, lineHeight: 1, color: C.accent }}>{sym}</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", fontSize: 44, fontWeight: 600, letterSpacing: -1.6, lineHeight: 1.1 }}>
              <span style={{ color: C.ink2 }}>Holders of quote tokens</span>
            </div>
          )}
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: -1, color: C.ink2, marginTop: 24 }}>have been sent</div>
          <div style={{ ...mono, display: "flex", fontSize: heroSize, fontWeight: 500, letterSpacing: -heroSize / 18, lineHeight: 1, color: C.bull, marginTop: 12 }}>{total}</div>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 600, letterSpacing: -1, marginTop: 18 }}>
            <span>{`by ${p.coins.toLocaleString("en-US")} community ${p.coins === 1 ? "coin" : "coins"}`}</span>
            {p.kind === "all" && <span style={{ color: C.ink2, marginLeft: 12 }}>{`across ${p.quoteAssets} tokens`}</span>}
          </div>
          {p.kind === "all" && (
            <div style={{ display: "flex", alignSelf: "flex-start", alignItems: "center", gap: 12, marginTop: 22, padding: "10px 20px", border: `1px solid ${C.accent}`, borderRadius: 999, ...mono, fontSize: 22, color: C.accent }}>
              <span>{`${p.active.toLocaleString("en-US")} coins in the mode`}</span>
              <span style={{ color: C.ink2 }}>pushed to holders · nothing to claim</span>
            </div>
          )}
          {p.kind === "quote" && p.tokens !== null && (
            <div style={{ display: "flex", alignSelf: "flex-start", alignItems: "center", gap: 12, marginTop: 22, padding: "10px 20px", border: `1px solid ${C.accent}`, borderRadius: 999, ...mono, fontSize: 22, color: C.accent }}>
              <span>{`${fmtAmt(p.tokens)} ${sym}`}</span>
              <span style={{ color: C.ink2 }}>pushed to holders · nothing to claim</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 28, marginTop: "auto" }}>
            {kpi("SHARE OF PAYOUTS", pct(p.shareBps), "of every holder payout")}
            {kpi("SINCE", p.firstAt ? day(p.firstAt) : "—", p.firstAt ? `${daysSince(p.firstAt, p.at)} ${daysSince(p.firstAt, p.at) === 1 ? "day" : "days"}` : null)}
            {kpi("COIN HOLDERS GOT", p.coinHoldersUsd !== null ? fmtUsd(p.coinHoldersUsd) : "—", `the other ${pct(10_000 - p.shareBps)}`)}
          </div>
        </div>

        {/* right: who sent it */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "30px 0 18px" }}>
          <div style={{ ...mono, display: "flex", fontSize: 16, letterSpacing: 2, color: C.ink3, paddingBottom: 8 }}>{p.kind === "quote" ? `TOP COINS PAYING ${sym} HOLDERS` : "TOP QUOTE TOKENS BY AMOUNT SENT"}</div>
          {p.rows.map(row)}
          {p.restCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, ...mono, fontSize: 19, color: C.ink2, paddingLeft: 48 }}>
              <span>{`+ ${p.restCount.toLocaleString("en-US")} more`}</span>
              <span style={{ fontSize: 26, color: C.ink }}>{fmtUsd(p.restUsd)}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 76, ...mono, fontSize: 17, color: C.ink3 }}>
        <div style={{ display: "flex" }}>{`${pct(p.shareBps)} of each community coin's holder payouts · USD at today's prices · ${day(p.at)} · NFA`}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, color: C.accent }}>
          <span style={{ color: C.ink2 }}>see more →</span>
          <span>{`${SITE_NAME}/rewards`}</span>
        </div>
      </div>
    </div>
  );
}
