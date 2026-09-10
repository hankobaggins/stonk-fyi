import type { Token } from "@/lib/types";
import { fmtPrice, fmtUsd, timeAgo } from "@/lib/format";
import { resolveImage } from "@/lib/api";
import { Delta, ModePill, StatusPill, TokenLink } from "./ui";
import TokenIcon from "./TokenIcon";
import { TradeLink } from "./BuyButton";

export default function TokenTable({ tokens, startRank = 1, now, compact = false }: { tokens: Token[]; startRank?: number; now: number; compact?: boolean }) {
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
            return (
              <tr key={t.mint}>
                <td className="r text-muted num">{startRank + i}</td>
                <td>
                  <TokenLink mint={t.mint}>
                    <span className="flex items-center gap-2.5">
                      <TokenIcon src={img} symbol={t.symbol} size={24} />
                      <span className="flex flex-col leading-tight">
                        <span className="font-medium">{t.symbol}</span>
                        <span className="text-[11px] text-muted max-w-[160px] truncate">{t.name}</span>
                      </span>
                    </span>
                  </TokenLink>
                </td>
                <td>
                  <span className="flex flex-col leading-tight">
                    <span>{t.quote.symbol}</span>
                    {(t.quote.categoryLabel ?? t.quote.category) && (t.quote.categoryLabel ?? t.quote.category) !== "Custom" && <span className="text-[11px] text-muted">{t.quote.categoryLabel ?? t.quote.category}</span>}
                  </span>
                </td>
                <td className="r num">{fmtPrice(m.priceUsd)}</td>
                <td className="r"><Delta value={m.priceChange24h} /></td>
                <td className="r num">{fmtUsd(m.marketCapUsd)}</td>
                <td className="r num">{fmtUsd(m.volume24hUsd)}</td>
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
