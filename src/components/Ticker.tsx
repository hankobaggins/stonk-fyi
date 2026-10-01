import type { StonkData } from "@/lib/stonk";
import { fmtNum, fmtPrice, fmtUsd, nowMs, timeAgo } from "@/lib/format";
import { usMarketOpen } from "@/lib/quote-math";

// One mono line under the nav on every page: eight segments at most (redesign 2026-09-13, Rationale §6), the
// last burn merged into one, the market-hours note as an amber chip on the SPYx segment. Server-rendered; never throws.
export default function Ticker({ d }: { d: StonkData }) {
  const now = nowMs();
  const m = d.token.market ?? {};
  const chg = m.priceChange24h;
  const lastBurn = d.burns?.burns[0];
  const spyxImplied = d.pool && m.priceUsd ? m.priceUsd * d.pool.price : null;
  const open = usMarketOpen(now);
  return (
    <div className="border-b border-border bg-surface-1">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 ticker !gap-5">
        <span><span className="k">STONK/SPYx</span> <b>{fmtPrice(m.priceUsd)}</b>{" "}
          {chg !== undefined && chg !== null && <span className={chg >= 0 ? "text-up" : "text-down"}>{chg >= 0 ? "+" : "−"}{Math.abs(chg).toFixed(1)}%</span>}
        </span>
        <span><span className="k">MCAP</span> <b>{fmtUsd(m.marketCapUsd)}</b></span>
        <span><span className="k">24H VOL</span> <b>{fmtUsd(m.volume24hUsd)}</b></span>
        <span><span className="k">BURNED</span> <b>{d.supply.burnedPct.toFixed(2)}%</b></span>
        {lastBurn && (
          <span><span className="k">LAST BURN</span> <b>{fmtNum(lastBurn.amountTokens)}</b> <span className="k">· {fmtUsd(lastBurn.valueUsdAtBurn)} · {timeAgo(lastBurn.burnedAt, now)}</span></span>
        )}
        {d.pool && <span><span className="k">POOL TVL</span> <b>{fmtUsd(d.pool.tvl)}</b></span>}
        {(d.holders || d.gmgn) && <span><span className="k">HOLDERS</span> <b>{fmtNum(d.holders?.latest.holders ?? d.gmgn?.holderCount)}</b></span>}
        {spyxImplied && (
          <span title={open ? "STONK is priced in SPYx. Implied from the pool ratio and STONK's USD price; the US market is open, so SPYx has a live reference." : "STONK is priced in SPYx. Outside US market hours the SPYx price is implied from the pool, not traded, so USD figures can drift."}>
            <span className="k">SPYx</span> <b>{fmtUsd(spyxImplied)}</b>{" "}
            {open ? (
              <span className="k">· implied</span>
            ) : (
              <span className="inline-flex items-center ml-1 px-1.5 py-0.5 rounded border border-caution/40 text-caution text-[10.5px] leading-none">implied · mkt closed</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
