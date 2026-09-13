import type { Buyback } from "@/lib/types";
import { fmtNum, fmtUsd, timeAgo } from "@/lib/format";
import { ExplorerLink } from "./ui";
import { shortAddr } from "@/lib/format";

export default function BuybackFeed({ buybacks, now, limit = 12, scroll = false }: { buybacks: Buyback[]; now: number; limit?: number; scroll?: boolean }) {
  const rows = buybacks.slice(0, limit);
  if (!rows.length) return <div className="text-sm text-muted">No recent buybacks.</div>;
  return (
    <div className={`table-wrap ${scroll ? "max-h-[420px] overflow-y-auto" : ""}`}>
      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th className="r">Spent</th>
            <th className="r">Value</th>
            <th className="r">Bought (STONK)</th>
            <th className="r">Buy tx</th>
            <th className="r">Burn tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.signature}>
              <td className="text-muted num">{timeAgo(b.boughtAt, now)}</td>
              <td className="r">
                <span className="num">{fmtNum(b.spentTokens, 4)}</span> <span className="text-secondary">{b.quote.symbol}</span>
              </td>
              <td className="r num">{fmtUsd(b.spentValueUsd)}</td>
              <td className="r num">{fmtNum(b.boughtTokens)}</td>
              <td className="r"><ExplorerLink addr={b.signature} kind="tx" label={`${shortAddr(b.signature, 4)} ↗`} /></td>
              <td className="r">{b.burnSignature ? <ExplorerLink addr={b.burnSignature} kind="tx" label={`${shortAddr(b.burnSignature, 4)} ↗`} /> : <span className="text-muted">pending</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
