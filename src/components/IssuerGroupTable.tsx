import Link from "next/link";
import { fmtPrice, fmtUsd } from "@/lib/format";
import type { IssuerGroup } from "@/lib/quote-math";
import { categoryLabel } from "@/lib/universe";

// One asset, several issuers: each token's own price, depth and volume side by side (/pairs and the asset page).
export default function IssuerGroupTable({ group, current }: { group: IssuerGroup; current?: string }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Token</th>
            <th>Issuer</th>
            <th className="r">Price</th>
            <th className="r">Liquidity</th>
            <th className="r">Own 24h volume</th>
          </tr>
        </thead>
        <tbody>
          {group.members.map((m) => (
            <tr key={m.mint} className={m.mint === current ? "bg-surface-2" : ""}>
              <td><Link href={`/pairs/${m.mint}`} className="font-medium hover:text-accent">{m.symbol}</Link></td>
              <td className="text-secondary">{categoryLabel(m.category)}</td>
              <td className="r num">{fmtPrice(m.priceUsd)}</td>
              <td className="r num">{fmtUsd(m.liquidityUsd)}</td>
              <td className="r num">{fmtUsd(m.volume24hUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
