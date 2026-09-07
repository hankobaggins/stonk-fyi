import { getRevenue, getRevenueHistory, getRewards, getStats } from "@/lib/api";
import { cumulative, fmtNum, fmtUsd, nowMs, timeAgo } from "@/lib/format";
import { KpiTile, PageHeader, Section, TokenLink } from "@/components/ui";
import { CumulativeChart, HBarChart, RevenueChart } from "@/components/charts";
import BuybackFeed from "@/components/BuybackFeed";

export const dynamic = "force-dynamic";
export const metadata = { title: "Flywheel" };

export default async function FlywheelPage() {
  const now = nowMs();
  const [revenue, history, rewards, stats] = await Promise.all([getRevenue(), getRevenueHistory(), getRewards(), getStats()]);
  const r = revenue.data;
  const days = history.data.days;

  const cumRevenue = cumulative(days, (d) => d.dailyRevenue);
  const series = days.map((d) => ({ date: d.date, holders: d.dailyHoldersRevenue, protocol: d.dailyProtocolRevenue }));
  const totalHolders = days.reduce((s, d) => s + d.dailyHoldersRevenue, 0);
  const totalProtocol = days.reduce((s, d) => s + d.dailyProtocolRevenue, 0);

  const burnSources = Object.entries(r.burns.bySource)
    .map(([name, v]) => ({ name, value: v.valueUsd, count: v.count, tokens: v.amountTokens }))
    .sort((a, b) => b.value - a.value);

  // Buyback spend by quote asset (from the recent feed — a sample, not lifetime).
  const spendByQuote = new Map<string, number>();
  for (const b of r.recentBuybacks) spendByQuote.set(b.quote.symbol, (spendByQuote.get(b.quote.symbol) ?? 0) + b.spentValueUsd);
  const spendData = [...spendByQuote.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12);

  const topRewards = [...rewards.data.launches].sort((a, b) => b.payoutCount - a.payoutCount).slice(0, 15);
  const totalPayouts = rewards.data.launches.reduce((s, l) => s + l.payoutCount, 0);

  const avgBuyback = r.revenue.buybackCount ? r.revenue.totalBuybackUsd / r.revenue.buybackCount : 0;
  const avgPrice = r.revenue.boughtBackTokens ? r.revenue.boughtBackValueUsd / r.revenue.boughtBackTokens : 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Flywheel" sub="Fee revenue → buybacks → burns. Everything on this page comes from StonkFun's ledger; tx signatures link to Solscan for verification." />

      <div className="kpis">
        <KpiTile label="Lifetime revenue" value={fmtUsd(r.revenue.totalRevenueUsd)} sub={`${fmtUsd(totalHolders)} holders · ${fmtUsd(totalProtocol)} protocol`} />
        <KpiTile label="Total buybacks" value={fmtUsd(r.revenue.totalBuybackUsd)} sub={`${fmtNum(r.revenue.buybackCount)} txs · avg ${fmtUsd(avgBuyback)}`} />
        <KpiTile label="STONK bought back" value={fmtNum(r.revenue.boughtBackTokens)} sub={`avg price ${fmtUsd(avgPrice, { compact: false, digits: 4 })}`} />
        <KpiTile label="Burned (USD at burn)" value={fmtUsd(r.burns.totalValueUsdAtBurn)} sub={`${fmtNum(r.burns.burnCount)} burns · last buyback ${timeAgo(r.revenue.lastBuybackAt, now)}`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Daily revenue split" className="lg:col-span-2">
          <RevenueChart data={series} height={280} />
        </Section>
        <Section title="Cumulative revenue">
          <CumulativeChart data={cumRevenue} height={280} />
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Burn value by source (USD at burn)">
          <HBarChart data={burnSources.map((b) => ({ name: b.name, value: b.value }))} valueLabel="USD burned" />
          <div className="table-wrap mt-3">
            <table className="data">
              <thead><tr><th>Source</th><th className="r">Burns</th><th className="r">Tokens</th><th className="r">USD</th></tr></thead>
              <tbody>
                {burnSources.map((b) => (
                  <tr key={b.name}><td>{b.name}</td><td className="r num">{fmtNum(b.count)}</td><td className="r num">{fmtNum(b.tokens)}</td><td className="r num">{fmtUsd(b.value)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Recent buyback spend by quote asset" action={<span className="text-xs text-muted">last {r.recentBuybacks.length} buybacks</span>}>
          <HBarChart data={spendData} valueLabel="Spent" />
          <div className="text-xs text-muted mt-2">Which quote assets the sweep is converting into STONK right now. Lifetime breakdown comes once the site has enough recorded buybacks.</div>
        </Section>
      </div>

      <Section title="Live buyback feed" action={<span className="text-xs text-muted">config: buybacks {r.config.buybacksEnabled ? "on" : "off"} · burn {r.config.buybackBurnEnabled ? "on" : "off"}</span>}>
        <BuybackFeed buybacks={r.recentBuybacks} now={now} limit={25} />
      </Section>

      <Section title="Holder rewards (reward-mode transfer tax)" action={<span className="text-xs text-muted num">{fmtNum(rewards.data.launches.length)} reward coins · {fmtNum(totalPayouts)} payouts · {fmtNum(stats.data.tokens.rewardLaunches)} reward launches</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Token</th><th>Paid in</th><th className="r">Distributed</th><th className="r">Payouts</th><th className="r">Holders</th><th className="r">Last payout</th></tr></thead>
            <tbody>
              {topRewards.map((l) => (
                <tr key={l.mint}>
                  <td><TokenLink mint={l.mint}><span className="font-mono text-xs">{l.mint.slice(0, 6)}…{l.mint.slice(-4)}</span></TokenLink></td>
                  <td>{l.quote.symbol}</td>
                  <td className="r num">{fmtNum(l.distributedTokens)} {l.quote.symbol}</td>
                  <td className="r num">{fmtNum(l.payoutCount)}</td>
                  <td className="r num">{fmtNum(l.holderCount)}</td>
                  <td className="r num text-muted">{timeAgo(l.lastPayoutAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
