import type { StonkData } from "@/lib/stonk";
import { fmtNum, fmtPrice, fmtUsd, nowMs, timeAgo } from "@/lib/format";

// Is the US equity market open right now? SPYx tracks an ETF, so STONK's USD price only has a
// live reference during these hours (Mon–Fri 09:30–16:00 America/New_York; holidays ignored).
function usMarketOpen(ts: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// One mono line under the nav on every page: the numbers a holder checks first, plus the
// SPYx dependency where it is always visible. Rendered server-side; never throws.
export default function Ticker({ d }: { d: StonkData }) {
  const now = nowMs();
  const m = d.token.market ?? {};
  const chg = m.priceChange24h;
  const lastBurn = d.burns?.burns[0];
  const spyxImplied = d.pool && m.priceUsd ? m.priceUsd * d.pool.price : null;
  const open = usMarketOpen(now);
  return (
    <div className="border-b border-border bg-surface-1">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 ticker">
        <span><span className="k">STONK/SPYx</span> <b>{fmtPrice(m.priceUsd)}</b>{" "}
          {chg !== undefined && chg !== null && <span className={chg >= 0 ? "text-up" : "text-down"}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>}
        </span>
        <span><span className="k">MCAP</span> <b>{fmtUsd(m.marketCapUsd)}</b></span>
        <span><span className="k">24H VOL</span> <b>{fmtUsd(m.volume24hUsd)}</b></span>
        <span><span className="k">BURNED</span> <b>{d.supply.burnedPct.toFixed(2)}%</b></span>
        {lastBurn && (
          <span><span className="k">LAST BURN</span> <b>{timeAgo(lastBurn.burnedAt, now)}</b> · {fmtNum(lastBurn.amountTokens)} STONK · {fmtUsd(lastBurn.valueUsdAtBurn)}</span>
        )}
        {d.pool && <span><span className="k">POOL TVL</span> <b>{fmtUsd(d.pool.tvl)}</b></span>}
        {d.gmgn && <span><span className="k">HOLDERS</span> <b>{fmtNum(d.gmgn.holderCount)}</b></span>}
        {spyxImplied && (
          <span>
            <span className="k">SPYx</span> <b>{fmtUsd(spyxImplied)}</b>{" "}
            <span className="k" title={open ? "Implied from the pool ratio and STONK's USD price. US market open: SPYx has a live reference." : "Implied from the pool ratio and STONK's USD price. US market closed: SPYx has no live reference, so USD figures can drift."}>· implied{open ? "" : " · mkt closed"}</span>
          </span>
        )}
      </div>
    </div>
  );
}
