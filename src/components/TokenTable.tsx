import type { Token } from "@/lib/types";
import type { AprCell, TokenApr } from "@/lib/yield";
import { fmtPrice, fmtUsd, timeAgo } from "@/lib/format";
import { resolveImage } from "@/lib/api";
import { Delta, ModePill, StatusPill, TokenLink } from "./ui";
import TokenIcon from "./TokenIcon";
import { TradeLink } from "./BuyButton";

const fmtApr = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";

const WHY: Record<NonNullable<TokenApr["why"]>, string> = {
  standard: "—",
  untracked: "not tracked",
  collecting: "collecting",
  unpriced: "unpriced",
  "no-db": "—",
  "db-error": "—",
};

// One realized-APR cell: a bar scaled to the largest APR on the page plus the figure. Empty cells say why.
export function AprCol({ c, max, cls, why }: { c: AprCell; max: number; cls: string; why: TokenApr["why"] }) {
  if (!c) return <span className="text-muted text-xs">{why ? WHY[why] : "—"}</span>;
  const w = max > 0 ? Math.max(2, (c.apr / max) * 100) : 0;
  return (
    <span className="flex items-center gap-3 justify-end" title={`${fmtUsd(c.usd)} paid over ${c.hours.toFixed(1)}h · ${hhmm(c.from)} → ${hhmm(c.to)}`}>
      <span className="aprbar w-20 sm:w-28 shrink-0"><i className={cls} style={{ width: `${w}%` }} /></span>
      <span className={`num text-[14px] font-medium w-16 text-right ${cls}`}>{fmtApr(c.apr)}</span>
    </span>
  );
}

// `apr` (per mint, from getAprForTokens) adds the two realized holder-fee APR columns in the /yield style.
export default function TokenTable({ tokens, startRank = 1, now, compact = false, apr }: { tokens: Token[]; startRank?: number; now: number; compact?: boolean; apr?: Record<string, TokenApr> }) {
  const max1 = apr ? Math.max(0, ...tokens.map((t) => apr[t.mint]?.d1?.apr ?? 0)) : 0;
  const max3 = apr ? Math.max(0, ...tokens.map((t) => apr[t.mint]?.d3?.apr ?? 0)) : 0;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th className="r">#</th>
            <th>Token</th>
            <th>Pair</th>
            <th className="r">Price</th>
            <th className="r">24h</th>
            <th className="r">Market cap</th>
            <th className="r">24h volume</th>
            {apr && (
              <>
                <th className="r">
                  24h-based APR<br />
                  <span className="normal-case tracking-normal text-[10px]">from the last 24h of payouts</span>
                </th>
                <th className="r">
                  3d-based APR<br />
                  <span className="normal-case tracking-normal text-[10px]">average over the last 72h</span>
                </th>
              </>
            )}
            {!compact && (
              <>
                <th className="r">Vol / MC</th>
                <th>Mode</th>
                <th>Status</th>
                <th className="r">Age</th>
              </>
            )}
            <th className="r">Trade</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t, i) => {
            const m = t.market ?? {};
            const ratio = m.marketCapUsd && m.volume24hUsd ? m.volume24hUsd / m.marketCapUsd : undefined;
            const img = resolveImage(t.imageUrl);
            const a = apr?.[t.mint];
            return (
              <tr key={t.mint}>
                <td className="r text-muted num">{String(startRank + i).padStart(2, "0")}</td>
                <td>
                  <TokenLink mint={t.mint}>
                    <span className="flex items-center gap-2.5">
                      <TokenIcon src={img} symbol={t.symbol} size={24} />
                      <span className="flex flex-col leading-tight">
                        <span className="font-medium text-[14px]">{t.symbol}</span>
                        <span className="text-[11px] text-muted max-w-[160px] truncate">{t.name}</span>
                      </span>
                    </span>
                  </TokenLink>
                </td>
                <td>
                  <span className="flex flex-col leading-tight">
                    <span className="font-medium">{t.quote.symbol}</span>
                    {(t.quote.categoryLabel ?? t.quote.category) && (t.quote.categoryLabel ?? t.quote.category) !== "Custom" && <span className="text-[11px] text-muted">{t.quote.categoryLabel ?? t.quote.category}</span>}
                  </span>
                </td>
                <td className="r num">{fmtPrice(m.priceUsd)}</td>
                <td className="r"><Delta value={m.priceChange24h} /></td>
                <td className="r num text-[14px]">{fmtUsd(m.marketCapUsd, { compact: true })}</td>
                <td className="r num">{fmtUsd(m.volume24hUsd, { compact: true })}</td>
                {apr && (
                  <>
                    <td className="r"><AprCol c={a?.d1 ?? null} max={max1} cls="apr1" why={a?.why ?? null} /></td>
                    <td className="r"><AprCol c={a?.d3 ?? null} max={max3} cls="apr3" why={a?.why ?? null} /></td>
                  </>
                )}
                {!compact && (
                  <>
                    <td className="r num text-secondary">{ratio !== undefined ? `${ratio.toFixed(2)}×` : "—"}</td>
                    <td><ModePill mode={t.mode} bps={t.transferFee?.bps} /></td>
                    <td><StatusPill status={t.status} progress={t.graduationProgress} /></td>
                    <td className="r text-muted num">{timeAgo(t.createdAt, now)}</td>
                  </>
                )}
                <td className="r"><TradeLink mint={t.mint} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
