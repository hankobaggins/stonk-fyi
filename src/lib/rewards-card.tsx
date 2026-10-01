import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import type { WalletView } from "@/lib/wallet-rewards-math";

// The two share cards for the wallet rewards check (/rewards/{wallet}): what one wallet has been paid by StonkFun's
// holder-reward distributor, in total (RewardsTotalCard) and by asset received (RewardsBreakdownCard). 1600×900, the
// wide frame of the yield card, so X shows them uncropped in the timeline. Pure: every figure is a prop, so the
// /rewards-card routes, the page preview and offline renders draw the same image.
export const REWARDS_CARD_SIZE = { width: 1600, height: 900 };
export const REWARDS_CARD_ROWS = 7;

export type RewardsCardAsset = {
  mint: string;
  symbol: string;
  amount: number;        // whole tokens received
  usd: number | null;    // at today's price; null = unpriced
  payouts: number;
  from: string[];        // reward coins this wallet holds / held that pay in this asset (inferred, may be empty)
};
export type RewardsCardData = {
  wallet: string;
  hideWallet?: boolean;
  totalUsd: number;
  last7dUsd: number | null;
  payouts: number;
  firstAt: string | null;
  lastAt: string | null;
  series: { t: string; usd: number }[];   // cumulative USD at today's prices, oldest first
  assets: RewardsCardAsset[];              // sorted by usd desc
  supplyBurnedPct: number;                 // the ring in the masthead
  at: string;
};

const mono = { fontFamily: "Geist Mono" };
export const fmtUsd = (n: number): string => {
  const a = Math.abs(n);
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
export const shortWallet = (w: string): string => `${w.slice(0, 4)}…${w.slice(-4)}`;
const day = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const daysBetween = (a: string, b: string): number => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));

function Masthead({ p, right }: { p: RewardsCardData; right: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, height: 104, borderBottom: `1px solid ${C.line}` }}>
      <Ring pct={p.supplyBurnedPct} size={34} stroke={C.accent} track={C.line} width={7} />
      <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
      <div style={{ ...mono, fontSize: 14, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 9px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
      <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>{right}</div>
    </div>
  );
}

// The loop: every card ends with where to check your own.
function Footer({ note }: { note: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 76, ...mono, fontSize: 17, color: C.ink3 }}>
      <div style={{ display: "flex" }}>{note}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, color: C.accent }}>
        <span style={{ color: C.ink2 }}>check yours →</span>
        <span>{`${SITE_NAME}/rewards`}</span>
      </div>
    </div>
  );
}

function Check({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="none" stroke={color} strokeWidth="2" />
      <path d="M7 12.5 L10.5 16 L17 8.5" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Cumulative curve: one green line that only climbs, filled underneath.
function Curve({ series, w, h }: { series: { t: string; usd: number }[]; w: number; h: number }) {
  if (series.length < 2) return <div style={{ display: "flex", width: w, height: h }} />;
  const t0 = Date.parse(series[0].t);
  const t1 = Date.parse(series[series.length - 1].t);
  const max = Math.max(...series.map((s) => s.usd)) || 1;
  const pad = 10;
  const X = (t: string) => pad + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (w - pad * 2);
  const Y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const pts = series.map((s) => `${X(s.t).toFixed(1)},${Y(s.usd).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${X(series[series.length - 1].t).toFixed(1)},${h} L${X(series[0].t).toFixed(1)},${h} Z`;
  const end = series[series.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} x2={w} y1={pad + f * (h - pad * 2)} y2={pad + f * (h - pad * 2)} stroke={C.line} strokeWidth={1} />
      ))}
      <path d={area} fill={C.bull} fillOpacity={0.14} />
      <path d={line} fill="none" stroke={C.bull} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(end.t)} cy={Y(end.usd)} r={11} fill={C.bg} stroke={C.bull} strokeWidth={5} />
    </svg>
  );
}

export function RewardsTotalCard(p: RewardsCardData) {
  const who = p.hideWallet ? "This wallet" : shortWallet(p.wallet);
  const held = p.firstAt ? daysBetween(p.firstAt, p.at) : null;
  const perDay = p.last7dUsd !== null ? p.last7dUsd / 7 : null;
  const kpi = (label: string, value: string, sub?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
      <div style={{ ...mono, display: "flex", fontSize: 17, letterSpacing: 2, color: C.ink3 }}>{label}</div>
      <div style={{ ...mono, display: "flex", fontSize: 50, fontWeight: 500, letterSpacing: -2, lineHeight: 1, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ ...mono, display: "flex", fontSize: 18, color: C.ink2, whiteSpace: "nowrap" }}>{sub ?? " "}</div>
    </div>
  );
  const total = fmtUsd(p.totalUsd);
  const heroSize = total.length <= 7 ? 196 : total.length <= 9 ? 160 : 132;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 72px" }}>
      <Masthead p={p} right="STONKFUN HOLDER REWARDS · SOLANA" />

      <div style={{ display: "flex", flex: 1 }}>
        {/* left: who, the number, three figures */}
        <div style={{ display: "flex", flexDirection: "column", width: 820, padding: "52px 56px 40px 0", borderRight: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34, fontWeight: 600, letterSpacing: -1 }}>
            <span style={{ ...mono, fontWeight: 500, color: p.hideWallet ? C.ink : C.accent }}>{who}</span>
            <span style={{ color: C.ink2 }}>has been paid</span>
          </div>
          <div style={{ ...mono, display: "flex", fontSize: heroSize, fontWeight: 500, letterSpacing: -heroSize / 18, lineHeight: 1, color: C.bull, marginTop: 26 }}>{total}</div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: -1, marginTop: 22 }}>
            <span>in StonkFun holder rewards.</span>
          </div>
          {p.last7dUsd !== null && p.last7dUsd > 0 && (
            <div style={{ display: "flex", alignSelf: "flex-start", alignItems: "center", gap: 12, marginTop: 30, padding: "12px 20px", border: `1px solid ${C.bull}`, borderRadius: 999, ...mono, fontSize: 22, color: C.bull }}>
              <span>{`▲ +${fmtUsd(p.last7dUsd)} in the last 7 days`}</span>
              {perDay !== null && <span style={{ color: C.ink2 }}>{`· ≈ ${fmtUsd(perDay)}/day`}</span>}
            </div>
          )}
          <div style={{ display: "flex", gap: 32, marginTop: "auto" }}>
            {kpi("PAYOUTS", p.payouts.toLocaleString("en-US"), "on-chain transfers")}
            {kpi("FIRST PAID", p.firstAt ? day(p.firstAt) : "—", held ? `${held} days ago` : undefined)}
            {kpi("PAID IN", String(p.assets.length), p.assets.length === 1 ? "asset" : "assets")}
          </div>
        </div>

        {/* right: the climb */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "52px 0 40px 56px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 17, letterSpacing: 2, color: C.ink3 }}>
            <span>CUMULATIVE · TODAY&apos;S PRICES</span>
            <span style={{ color: C.bull }}>{total}</span>
          </div>
          <div style={{ display: "flex", marginTop: 22 }}>
            <Curve series={p.series} w={580} h={410} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 16, color: C.ink3, marginTop: 10 }}>
            <span>{p.firstAt ? day(p.firstAt) : ""}</span>
            <span>{day(p.at)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "auto", ...mono, fontSize: 18, color: C.ink2 }}>
            <Check size={26} color={C.bull} />
            <span>pushed straight to the wallet · nothing to claim</span>
          </div>
        </div>
      </div>

      <Footer note="On-chain transfers from StonkFun's distributor · USD at today's prices · not financial advice" />
    </div>
  );
}

// Colour options for the breakdown card's "N assets" and share bars (owner picks one; the total stays bull green).
export const BREAKDOWN_TONES = { teal: C.accent, gold: "#f0c24b", violet: "#9085e9" } as const;
export type BreakdownTone = keyof typeof BREAKDOWN_TONES;

export function RewardsBreakdownCard(p: RewardsCardData & { tone?: BreakdownTone }) {
  const tone = BREAKDOWN_TONES[p.tone ?? "teal"];
  const who = p.hideWallet ? "This wallet" : shortWallet(p.wallet);
  const rows = p.assets.slice(0, REWARDS_CARD_ROWS);
  const rest = p.assets.slice(REWARDS_CARD_ROWS);
  const restUsd = rest.reduce((s, a) => s + (a.usd ?? 0), 0);
  const maxUsd = Math.max(1e-9, ...rows.map((r) => r.usd ?? 0));
  const top = rows[0];
  const topShare = top?.usd && p.totalUsd > 0 ? (top.usd / p.totalUsd) * 100 : null;
  const fromLabel = (f: string[]) => (f.length === 0 ? "" : f.length === 1 ? `FROM ${f[0]}` : `FROM ${f[0]} +${f.length - 1}`);
  const total = fmtUsd(p.totalUsd);
  const totalSize = total.length <= 6 ? 140 : total.length <= 7 ? 124 : total.length <= 9 ? 100 : 84;

  const stat = (label: string, value: string, sub: string | null, color: string = C.ink) => (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "16px 0", borderTop: `1px solid ${C.line}` }}>
      <div style={{ ...mono, display: "flex", fontSize: 17, letterSpacing: 2, color: C.ink3 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ ...mono, display: "flex", fontSize: 34, fontWeight: 500, letterSpacing: -1.2, color, whiteSpace: "nowrap" }}>{value}</div>
        {sub && <div style={{ ...mono, display: "flex", fontSize: 17, color: C.ink2, whiteSpace: "nowrap" }}>{sub}</div>}
      </div>
    </div>
  );

  const row = (r: RewardsCardAsset, i: number) => (
    <div key={r.mint} style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 9, flex: 1, borderBottom: i < rows.length - 1 || rest.length ? `1px solid ${C.line}` : "none" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <div style={{ ...mono, display: "flex", width: 36, flexShrink: 0, fontSize: 18, color: C.ink3 }}>{String(i + 1).padStart(2, "0")}</div>
        <div style={{ display: "flex", width: 160, flexShrink: 0, fontSize: 30, fontWeight: 600, letterSpacing: -0.8, whiteSpace: "nowrap", overflow: "hidden" }}>{r.symbol}</div>
        <div style={{ ...mono, display: "flex", flex: 1, minWidth: 0, fontSize: 15, color: C.ink3, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden" }}>{fromLabel(r.from)}</div>
        <div style={{ ...mono, display: "flex", width: 190, flexShrink: 0, justifyContent: "flex-end", fontSize: 19, color: C.ink2, whiteSpace: "nowrap" }}>{`${fmtAmt(r.amount)} ${r.symbol}`}</div>
        <div style={{ ...mono, display: "flex", width: 150, flexShrink: 0, justifyContent: "flex-end", fontSize: 32, fontWeight: 500, letterSpacing: -1.2, whiteSpace: "nowrap", color: r.usd === null ? C.ink3 : C.ink }}>{r.usd === null ? "unpriced" : fmtUsd(r.usd)}</div>
      </div>
      <div style={{ display: "flex", height: 6, background: C.line, borderRadius: 3, marginLeft: 50 }}>
        <div style={{ display: "flex", width: `${Math.max(1, ((r.usd ?? 0) / maxUsd) * 100)}%`, background: tone, borderRadius: 3 }} />
      </div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 72px" }}>
      <Masthead p={p} right="STONKFUN HOLDER REWARDS · BY ASSET" />

      <div style={{ display: "flex", flex: 1, gap: 56 }}>
        {/* left: headline, the total as the hero, a short ledger to the floor */}
        <div style={{ display: "flex", flexDirection: "column", width: 540, padding: "40px 56px 22px 0", borderRight: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, fontSize: 52, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>
            <span style={{ ...mono, fontSize: 40, fontWeight: 500, letterSpacing: -1, color: p.hideWallet ? C.ink : C.accent }}>{who}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, fontSize: 52, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05, marginTop: 10 }}>
            <span>got paid in</span>
            <span style={{ color: tone }}>{`${p.assets.length} ${p.assets.length === 1 ? "asset" : "assets"}`}</span>
          </div>
          <div style={{ ...mono, display: "flex", fontSize: 17, letterSpacing: 2, color: C.ink3, marginTop: 34 }}>TOTAL · TODAY&apos;S PRICES</div>
          <div style={{ ...mono, display: "flex", fontSize: totalSize, fontWeight: 500, letterSpacing: -totalSize / 18, lineHeight: 1, color: C.bull, marginTop: 14 }}>{total}</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
            {stat("BIGGEST EARNER", top?.symbol ?? "—", topShare !== null ? `${topShare.toFixed(0)}% of it` : null)}
            {stat("LAST 7 DAYS", p.last7dUsd !== null ? `+${fmtUsd(p.last7dUsd)}` : "—", null, C.bull)}
            {stat("PAYOUTS", p.payouts.toLocaleString("en-US"), "transfers")}
            {stat("FIRST PAID", p.firstAt ? day(p.firstAt) : "—", p.firstAt ? `${daysBetween(p.firstAt, p.at)} days ago` : null)}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "14px 0" }}>
          {rows.map(row)}
          {rest.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, ...mono, fontSize: 19, color: C.ink2, paddingLeft: 50 }}>
              <span>{`+ ${rest.length} more ${rest.length === 1 ? "asset" : "assets"}`}</span>
              <span style={{ fontSize: 26, color: C.ink }}>{fmtUsd(restUsd)}</span>
            </div>
          )}
        </div>
      </div>

      <Footer note="Amounts received on-chain · USD at today's prices · source coin inferred · not financial advice" />
    </div>
  );
}

// The page view → card props (shared by the card route and the page preview).
export function cardDataOf(v: WalletView, supplyBurnedPct: number, hideWallet: boolean, at: string): RewardsCardData {
  return {
    wallet: v.wallet, hideWallet, totalUsd: v.totalUsd, last7dUsd: v.last7dUsd, payouts: v.payouts, firstAt: v.firstAt, lastAt: v.lastAt,
    series: v.series, assets: v.assets.map((a) => ({ mint: a.mint, symbol: a.symbol, amount: a.amount, usd: a.usd, payouts: a.payouts, from: a.from })),
    supplyBurnedPct, at,
  };
}

