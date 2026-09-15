import type { CoinProfileRow } from "@/lib/coin-profiles";
import { fmtNum, fmtUsd, timeAgo } from "@/lib/format";
import { resolveImage } from "@/lib/api";
import TokenIcon from "./TokenIcon";
import { TokenLink } from "./ui";
import { TradeLink } from "./BuyButton";
import { Swatch } from "./Populations";

// The largest launched coins by market cap, each with HolderScan's holder count, HolderScan's own 24h / 7d / 30d
// change, average hold time, and a sparkline of this site's hourly readings (lib/coin-profiles.ts). A server
// component: rank is the order, nothing to sort or toggle. Rows are plain data.

const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

function Change({ abs, holders, days, readAt, hint }: { abs: number | null; holders: number | null; days: number; readAt: string | null; hint?: string }) {
  if (abs === null || holders === null) return <span className="text-muted text-xs" title={hint}>—</span>;
  const base = holders - abs;
  const pct = base > 0 ? (abs / base) * 100 : null;
  const cls = abs > 0 ? "text-up" : abs < 0 ? "text-down" : "text-muted";
  return (
    <span className="num" title={`HolderScan's own ${days === 1 ? "1-day" : `${days}-day`} change in holders, as of ${readAt?.slice(0, 16).replace("T", " ") ?? "?"} UTC`}>
      <span className={`${cls} text-[14px]`}>{signed(abs)}</span>
      {pct !== null && <span className="text-muted text-xs"> {pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>}
    </span>
  );
}

export function fmtHold(sec: number | null): string {
  if (sec === null || !(sec >= 0)) return "—";
  const h = sec / 3600;
  if (h < 1) return `${Math.round(sec / 60)} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  const d = h / 24;
  return d < 100 ? `${d.toFixed(1)}d` : `${Math.round(d)}d`;
}

// Inline SVG sparkline of the site's own hourly holder readings, in the HolderScan population colour (status colours
// are for scorecard states, never chart series — rule 8); the direction is in the title and the change cells.
function Spark({ pts, w = 112, h = 28 }: { pts: { ts: number; holders: number }[]; w?: number; h?: number }) {
  if (pts.length < 2) return <span className="state collecting text-[10px]">collecting</span>;
  const xs = pts.map((p) => p.ts);
  const ys = pts.map((p) => p.holders);
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const sx = (t: number) => (x1 > x0 ? ((t - x0) / (x1 - x0)) * (w - 2) + 1 : 1);
  const sy = (v: number) => (yMax > yMin ? h - 2 - ((v - yMin) / (yMax - yMin)) * (h - 4) : h / 2);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.ts).toFixed(1)},${sy(p.holders).toFixed(1)}`).join(" ");
  const delta = ys[ys.length - 1] - ys[0];
  const stroke = "var(--series-7)";
  const hours = (x1 - x0) / 3.6e6;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${fmtNum(ys[0])} → ${fmtNum(ys[ys.length - 1])} holders over ${hours < 48 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)}d`}`} className="block">
      <title>{`${signed(delta)} over the site's last ${hours < 48 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)} days`} of hourly readings (${pts.length} points)`}</title>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(x1)} cy={sy(ys[ys.length - 1])} r={2} fill={stroke} />
    </svg>
  );
}

export default function TopCoins({ rows, now, everyH }: { rows: CoinProfileRow[]; now: number; everyH: number }) {
  const nextRead = (() => {
    // The worker reads on the :25 tick every `everyH` hours from 00:25 UTC.
    const d = new Date(now);
    const slot = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 25));
    while (slot.getTime() <= now || slot.getUTCHours() % everyH !== 0) slot.setTime(slot.getTime() + 3.6e6);
    const m = Math.round((slot.getTime() - now) / 60000);
    return m < 60 ? `${m} min` : `${Math.round(m / 60)}h`;
  })();
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th className="r st1">#</th>
            <th className="st2 min-w-[160px]">Coin</th>
            <th className="r">Market cap</th>
            <th className="r"><Swatch p="holderscan" />Holders</th>
            <th className="r">24h</th>
            <th className="r">7d</th>
            <th className="r">30d</th>
            <th className="r">Avg hold</th>
            <th className="r p3"><Swatch p="paid" />StonkFun-paid</th>
            <th className="p3">7d, hourly</th>
            <th className="r"><span className="sr-only">Trade</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mint}>
              <td className="r text-muted num st1">{String(r.rank).padStart(2, "0")}</td>
              <td className="st2">
                <div className="flex items-center gap-2 min-w-0">
                  <TokenIcon src={resolveImage(r.imageUrl)} symbol={r.symbol} size={24} />
                  <div className="min-w-0 leading-tight">
                    <TokenLink mint={r.mint}>
                      <span className="font-medium">{r.symbol}</span>
                    </TokenLink>
                    <div className="text-[11px] text-muted truncate max-w-[160px]">{r.name} · {r.quoteSymbol}</div>
                  </div>
                </div>
              </td>
              <td className="r num">{fmtUsd(r.marketCapUsd, { compact: true })}</td>
              <td className="r num">
                {r.holders !== null ? (
                  <>
                    <span className="text-[14px]">{fmtNum(r.holders)}</span>
                    <div className="text-[10px] text-muted">{timeAgo(r.readAt, now)}</div>
                  </>
                ) : (
                  <span className="text-muted text-xs" title={`No HolderScan reading stored for this coin yet — it entered the top ${rows.length} since the last read, or HolderScan does not track it. Next read in ${nextRead}.`}>next read in {nextRead}</span>
                )}
              </td>
              <td className="r"><Change abs={r.d1} holders={r.holders} days={1} readAt={r.readAt} hint={r.holders !== null ? "HolderScan gave no 1-day figure on this read" : undefined} /></td>
              <td className="r"><Change abs={r.d7} holders={r.holders} days={7} readAt={r.readAt} /></td>
              <td className="r"><Change abs={r.d30} holders={r.holders} days={30} readAt={r.readAt} hint={r.holders !== null && r.d30 === null ? "younger than the window, or HolderScan gave no 30-day figure" : undefined} /></td>
              <td className="r num" title={r.retention !== null ? `HolderScan: average time held by current holders · retention ${(r.retention * 100).toFixed(0)}%` : "HolderScan: average time held by current holders"}>
                {r.avgHoldSec !== null ? fmtHold(r.avgHoldSec) : <span className="text-muted text-xs" title="HolderScan has not profiled this coin's hold times">n/a</span>}
              </td>
              <td className="r num p3">{r.paid !== null ? fmtNum(r.paid) : <span className="text-muted text-xs" title="Standard-mode coin: no reward-eligible holder figure">standard</span>}</td>
              <td className="p3"><Spark pts={r.series} /></td>
              <td className="r"><TradeLink mint={r.mint} label="Trade ↗" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
