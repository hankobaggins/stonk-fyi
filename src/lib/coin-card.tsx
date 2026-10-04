import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";

// Square (1080×1080) per-coin card for the wallet rewards check (§6o): what one reward coin — or, when several coins
// this wallet holds pay in the same asset, that group — has paid this wallet, in the asset it pays. The chain records
// the asset paid, not the coin, so a card is one reward asset: exact when one held coin pays in it, a named group when
// several do (never a guessed split). Coin and asset logos arrive as data URIs (fetched and converted server-side,
// initials when a logo can't be read). Pure: the route, the page and offline renders draw the same image.
export const COIN_CARD_SIZE = { width: 1080, height: 1080 };

export type CardCoin = { mint: string; symbol: string; name?: string | null; image?: string | null; holders?: number | null; paidUsd?: number | null };
export type CoinCardData = {
  wallet: string;
  hideWallet?: boolean;
  coins: CardCoin[];                    // the held coin(s) that pay in this asset, largest first
  reward: { mint: string; symbol: string; image?: string | null };
  amount: number;                        // whole tokens of the reward asset received
  usd: number | null;                    // today's price
  payouts: number | null;                // null = not countable (community share summed from per-day records)
  // §6p: "community" = paid as a holder of the reward asset by Community Mode coins (no held coin pays in it);
  // "mixed" = held coins pay in it AND the wallet holds it while community coins pay its holders (not split).
  kind?: "coin" | "community" | "mixed";
  communityCoins?: number;
  firstAt: string | null;
  last7dUsd: number | null;
  supplyBurnedPct: number;
  at: string;
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
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Initials on a colour derived from the mint, for a logo that could not be fetched or decoded.
const HUES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767", "#7cc0d4"];
export function Logo({ src, label, mint, size, ring = C.line }: { src?: string | null; label: string; mint: string; size: number; ring?: string }) {
  const box = { width: size, height: size, borderRadius: size, border: `${Math.max(2, size / 40)}px solid ${ring}`, display: "flex", overflow: "hidden", flexShrink: 0 } as const;
  // eslint-disable-next-line @next/next/no-img-element -- next/og draws a plain <img> (a data URI), not next/image
  if (src) return <img src={src} width={size} height={size} alt="" style={{ ...box, objectFit: "cover" }} />;
  const hue = HUES[[...mint].reduce((a, ch) => a + ch.charCodeAt(0), 0) % HUES.length];
  return (
    <div style={{ ...box, alignItems: "center", justifyContent: "center", background: hue, color: C.bg, fontSize: size * 0.36, fontWeight: 600, letterSpacing: -1 }}>
      {label.replace(/^\$/, "").slice(0, 2).toUpperCase()}
    </div>
  );
}

export function CoinCard(p: CoinCardData) {
  const cmOnly = p.kind === "community" || !p.coins.length;
  const mixed = p.kind === "mixed";
  const lead = p.coins[0] ?? { mint: p.reward.mint, symbol: p.reward.symbol, image: p.reward.image };
  const group = p.coins.length > 1;
  const names = cmOnly ? p.reward.symbol : group ? `${lead.symbol} + ${p.coins.length - 1} more` : lead.symbol;
  const nCm = p.communityCoins ?? 0;
  const hero = p.usd !== null ? fmtUsd(p.usd) : `${fmtAmt(p.amount)}`;
  const heroSize = hero.length <= 5 ? 260 : hero.length <= 6 ? 236 : hero.length <= 7 ? 204 : hero.length <= 8 ? 180 : 150;
  const perDay = p.last7dUsd !== null && p.last7dUsd > 0 ? p.last7dUsd / 7 : null;
  const stat = (label: string, value: string, sub: string, left = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, ...(left ? { paddingLeft: 40, borderLeft: `1px solid ${C.line}` } : {}) }}>
      <div style={{ ...mono, display: "flex", fontSize: 22, letterSpacing: 2.5, color: C.ink3, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ ...mono, display: "flex", fontSize: 84, fontWeight: 500, letterSpacing: -3, lineHeight: 1, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ ...mono, display: "flex", fontSize: 24, color: C.ink2, whiteSpace: "nowrap" }}>{sub}</div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 64px" }}>
      {/* masthead */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, height: 92, borderBottom: `1px solid ${C.line}` }}>
        <Ring pct={p.supplyBurnedPct} size={30} stroke={C.accent} track={C.line} width={6} />
        <div style={{ fontSize: 27, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        <div style={{ ...mono, fontSize: 13, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "5px 8px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
        <div style={{ ...mono, fontSize: 18, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>STONKFUN HOLDER REWARDS</div>
      </div>

      {/* the pipe: coin → pays holders in → reward asset */}
      <div style={{ display: "flex", alignItems: "center", gap: 30, padding: "34px 0 32px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {cmOnly ? (
            <Logo src={p.reward.image} label={p.reward.symbol} mint={p.reward.mint} size={156} ring={C.lineStrong} />
          ) : (
            p.coins.slice(0, 3).map((c, i) => (
              <div key={c.mint} style={{ display: "flex", marginLeft: i ? -52 : 0 }}>
                <Logo src={c.image} label={c.symbol} mint={c.mint} size={i ? 116 : 156} ring={i ? C.bg : C.lineStrong} />
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 6 }}>
          <div style={{ display: "flex", fontSize: names.length <= 8 ? 76 : names.length <= 12 ? 62 : 52, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden" }}>{names}</div>
          <div style={{ display: "flex", fontSize: 30, color: C.ink2, whiteSpace: "nowrap", overflow: "hidden" }}>
            {cmOnly ? "Community Mode payouts" : mixed ? `${group ? p.coins.map((c) => c.symbol).join(" · ") : lead.name ?? lead.symbol} + community coins` : group ? p.coins.map((c) => c.symbol).join(" · ") : lead.name ?? "StonkFun reward coin"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
          <div style={{ ...mono, display: "flex", fontSize: 18, letterSpacing: 2, color: C.ink3 }}>{cmOnly ? "PAID BY COMMUNITY" : "PAYS HOLDERS IN"}</div>
          {cmOnly ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 28px", border: `2px solid ${C.accent}`, borderRadius: 999 }}>
              <div style={{ ...mono, display: "flex", fontSize: 44, fontWeight: 500, letterSpacing: -1.5, color: C.accent }}>{nCm.toLocaleString("en-US")}</div>
              <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: C.accent }}>{nCm === 1 ? "coin" : "coins"}</div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 26px 10px 10px", border: `2px solid ${C.accent}`, borderRadius: 999 }}>
              <Logo src={p.reward.image} label={p.reward.symbol} mint={p.reward.mint} size={72} />
              <div style={{ display: "flex", fontSize: 46, fontWeight: 600, letterSpacing: -1.5, color: C.accent }}>{p.reward.symbol}</div>
            </div>
          )}
        </div>
      </div>

      {/* the number */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 42, fontWeight: 600, letterSpacing: -1.2 }}>
          <span style={{ ...mono, fontWeight: 500, color: p.hideWallet ? C.ink : C.accent }}>{p.hideWallet ? "This wallet" : short(p.wallet)}</span>
          <span style={{ color: C.ink2 }}>has been paid</span>
        </div>
        <div style={{ ...mono, display: "flex", fontSize: heroSize, fontWeight: 500, letterSpacing: -heroSize / 18, lineHeight: 0.95, color: C.bull, marginTop: 14 }}>{hero}</div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 600, letterSpacing: -1.2, marginTop: 16 }}>
          <span style={{ ...mono, fontWeight: 500 }}>{`${fmtAmt(p.amount)} ${p.reward.symbol}`}</span>
          <span style={{ color: C.ink2, marginLeft: 12 }}>{cmOnly ? `for holding ${p.reward.symbol}` : mixed ? `for holding ${group ? "these" : lead.symbol} + ${p.reward.symbol}` : group ? "for holding these coins" : `for holding ${lead.symbol}`}</span>
        </div>
        {perDay !== null && (
          <div style={{ display: "flex", alignSelf: "flex-start", alignItems: "center", gap: 12, marginTop: 24, padding: "12px 24px", border: `2px solid ${C.bull}`, borderRadius: 999, ...mono, fontSize: 27, color: C.bull }}>
            <span>{`▲ +${fmtUsd(p.last7dUsd ?? 0)} in the last 7 days`}</span>
            <span style={{ color: C.ink2 }}>{`· ≈ ${fmtUsd(perDay)}/day`}</span>
          </div>
        )}
      </div>

      {/* stats */}
      <div style={{ display: "flex", gap: 40, padding: "28px 0", borderTop: `1px solid ${C.line}` }}>
        {stat("PAYOUTS", p.payouts !== null ? p.payouts.toLocaleString("en-US") : "—", p.payouts !== null ? `transfers in ${p.reward.symbol}` : "count spans earlier payouts")}
        {stat("FIRST PAID", p.firstAt ? day(p.firstAt) : "—", p.firstAt ? ((n) => `${n} ${n === 1 ? "day" : "days"} ago`)(Math.max(1, Math.round((Date.parse(p.at) - Date.parse(p.firstAt)) / 86_400_000))) : " ", true)}
      </div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 70, ...mono, fontSize: 16, color: C.ink3 }}>
        <div style={{ display: "flex" }}>{cmOnly ? "33% of community coins' payouts go to quote holders · NFA" : mixed ? "Incl. community-coin payouts: not split · NFA" : group ? "One reward token, several coins: not split · NFA" : "On-chain payouts · today's prices · not financial advice"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 21 }}>
          <span style={{ color: C.ink2 }}>check yours →</span>
          <span style={{ color: C.accent }}>{`${SITE_NAME}/rewards`}</span>
        </div>
      </div>
    </div>
  );
}
