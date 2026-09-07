import Link from "next/link";
import { getTopTokens } from "@/lib/api";
import { fmtNum, fmtUsd } from "@/lib/format";
import { PageHeader, Section } from "@/components/ui";
import { HBarChart, ShareBar } from "@/components/charts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pairs" };

type Agg = { key: string; label: string; category?: string; tokens: number; volume: number; mcap: number; graduated: number; topSymbol?: string; topMcap: number };

export default async function PairsPage() {
  // Aggregate the top 300 tokens by volume — this captures effectively all active volume.
  const tokens = await getTopTokens(300, "volume");

  const byQuote = new Map<string, Agg>();
  const byCategory = new Map<string, Agg>();
  const bump = (map: Map<string, Agg>, key: string, label: string, t: (typeof tokens)[number], category?: string) => {
    const a = map.get(key) ?? { key, label, category, tokens: 0, volume: 0, mcap: 0, graduated: 0, topMcap: 0 };
    a.tokens++;
    a.volume += t.market?.volume24hUsd ?? 0;
    a.mcap += t.market?.marketCapUsd ?? 0;
    if (t.status === "graduated") a.graduated++;
    if ((t.market?.marketCapUsd ?? 0) > a.topMcap) {
      a.topMcap = t.market?.marketCapUsd ?? 0;
      a.topSymbol = t.symbol;
    }
    map.set(key, a);
  };
  for (const t of tokens) {
    bump(byQuote, t.quote.mint, t.quote.symbol, t, t.quote.categoryLabel ?? t.quote.category);
    bump(byCategory, t.quote.category ?? "other", t.quote.categoryLabel ?? t.quote.category ?? "Other", t);
  }
  const quotes = [...byQuote.values()].sort((a, b) => b.volume - a.volume);
  const cats = [...byCategory.values()].sort((a, b) => b.volume - a.volume);
  const totalVol = tokens.reduce((s, t) => s + (t.market?.volume24hUsd ?? 0), 0);

  const top8 = quotes.slice(0, 8);
  const otherVol = quotes.slice(8).reduce((s, q) => s + q.volume, 0);
  const shareData = [...top8.map((q) => ({ name: q.label, value: q.volume })), ...(otherVol > 0 ? [{ name: "Other", value: otherVol }] : [])];

  return (
    <div className="space-y-5">
      <PageHeader title="Pairs" sub={`What StonkFun tokens are priced against · top ${tokens.length} tokens by volume · ${fmtUsd(totalVol)} 24h volume`} />

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="24h volume share by quote asset">
          <ShareBar data={shareData} />
        </Section>
        <Section title="24h volume by pair category">
          <HBarChart data={cats.map((c) => ({ name: c.label, value: c.volume }))} valueLabel="24h volume" />
        </Section>
      </div>

      <Section title="Quote assets">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Quote</th>
                <th>Category</th>
                <th className="r">Tokens</th>
                <th className="r">Graduated</th>
                <th className="r">24h volume</th>
                <th className="r">Share</th>
                <th className="r">Market cap</th>
                <th>Largest token</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.key}>
                  <td>
                    <Link href={`/tokens?quoteMint=${q.key}&sort=volume`} className="font-medium hover:text-accent">
                      {q.label}
                    </Link>
                  </td>
                  <td className="text-secondary">{q.category ?? "—"}</td>
                  <td className="r num">{q.tokens}</td>
                  <td className="r num">{q.graduated}</td>
                  <td className="r num">{fmtUsd(q.volume)}</td>
                  <td className="r num text-secondary">{totalVol ? `${((q.volume / totalVol) * 100).toFixed(1)}%` : "—"}</td>
                  <td className="r num">{fmtUsd(q.mcap)}</td>
                  <td className="text-secondary">
                    {q.topSymbol} <span className="text-muted num">({fmtUsd(q.topMcap)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-muted mt-3">{fmtNum(quotes.length)} distinct quote assets among the top {tokens.length} tokens.</div>
      </Section>
    </div>
  );
}
