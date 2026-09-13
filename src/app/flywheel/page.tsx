import Link from "next/link";
import { getRevenue, getRevenueHistory, getRewards, getStats } from "@/lib/api";
import { cumulative, fmtNum, fmtUsd, nowMs, timeAgo } from "@/lib/format";
import { KpiTile, PageHeader, Section, TokenLink } from "@/components/ui";
import { CountBarChart, CumulativeChart, HBarChart } from "@/components/charts";
import BuybackFeed from "@/components/BuybackFeed";

export const dynamic = "force-dynamic";
export const metadata = { title: "Flywheel" };

export default async function FlywheelPage() {
  const now = nowMs();
  const [revenue, history, rewards, stats] = await Promise.all([getRevenue(), getRevenueHistory(), getRewards(), getStats()]);
  const r = revenue.data;
  const days = history.data.days;

  const totalHolders = days.reduce((s, d) => s + d.dailyHoldersRevenue, 0);
  const totalProtocol = days.reduce((s, d) => s + d.dailyProtocolRevenue, 0);

  // Buyback dollars per day ≈ daily revenue × lifetime buyback share, and its running total. An estimate until the
  // site's own recorded buybacks cover the history; labelled as one. The per-transaction ledger is the feed below.
  const buybackShare = r.revenue.totalRevenueUsd ? r.revenue.totalBuybackUsd / r.revenue.totalRevenueUsd : 0;
  const buybackSeries = days.map((d) => ({ date: d.date, value: d.dailyRevenue * buybackShare }));
  const cumBuyback = cumulative(days, (d) => d.dailyRevenue * buybackShare);

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
      <PageHeader
        title="Flywheel"
        sub={<>Fee revenue → buybacks → burns. Everything here comes from StonkFun&apos;s ledger; tx signatures link to Solscan for verification. Revenue charts live on <Link href="/platform" className="text-secondary hover:text-primary">Platform</Link>, holder payouts on <Link href="/rewards" className="text-secondary hover:text-primary">Rewards</Link>.</>}
      >
        <span className="num text-xs text-muted whitespace-nowrap">last buyback {timeAgo(r.revenue.lastBuybackAt, now)} · 30s</span>
      </PageHeader>

      <div className="kpis">
        <KpiTile label="Lifetime revenue" value={fmtUsd(r.revenue.totalRevenueUsd)} sub={`${fmtUsd(totalHolders)} holders · ${fmtUsd(totalProtocol)} protocol`} />
        <KpiTile label="Total buybacks" value={fmtUsd(r.revenue.totalBuybackUsd)} sub={`${fmtNum(r.revenue.buybackCount)} txs · avg ${fmtUsd(avgBuyback)}`} />
        <KpiTile label="STONK bought back" value={fmtNum(r.revenue.boughtBackTokens)} sub={`${fmtUsd(r.revenue.boughtBackValueUsd)} · avg ${fmtUsd(avgPrice, { compact: false, digits: 4 })}`} />
        <KpiTile label="Burned (USD at burn)" value={fmtUsd(r.burns.totalValueUsdAtBurn)} sub={`${fmtNum(r.burns.burnCount)} burns · last buyback ${timeAgo(r.revenue.lastBuybackAt, now)}`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Estimated STONK buybacks per day (USD)" className="lg:col-span-2" action={<span className="num text-[11px] text-muted">daily · UTC · StonkFun revenue history · 5 min</span>}>
          <CountBarChart data={buybackSeries} height={240} name="Buybacks" fmt="usd" />
          <p className="text-xs text-muted mt-2.5">Daily fee revenue × lifetime buyback share ({(buybackShare * 100).toFixed(0)}%), summed per UTC day. An estimate; the per-transaction record is the feed below.</p>
        </Section>
        <Section title="Cumulative buyback spend" action={<span className="num text-[11px] text-muted">since {history.data.start} · estimate</span>}>
          <CumulativeChart data={cumBuyback} height={240} name="Cumulative buybacks" />
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Burn value by source" action={<span className="num text-[11px] text-muted">lifetime · USD at burn</span>}>
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
        <Section title="Recent buyback spend by quote asset" action={<span className="num text-[11px] text-muted">last {r.recentBuybacks.length} buybacks</span>}>
          <HBarChart data={spendData} valueLabel="Spent" />
          <p className="text-xs text-muted mt-3 leading-relaxed">Which fee currencies the protocol swept most recently. Order follows the ledger, not rank; a lifetime breakdown comes once the site has enough recorded buybacks.</p>
        </Section>
      </div>

      <Section title="Live buyback feed" action={<span className="num text-[11px] text-muted flex gap-3.5"><span>buybacks <b className={`font-medium ${r.config.buybacksEnabled ? "text-up" : "text-caution"}`}>{r.config.buybacksEnabled ? "on" : "off"}</b> · burn <b className={`font-medium ${r.config.buybackBurnEnabled ? "text-up" : "text-caution"}`}>{r.config.buybackBurnEnabled ? "on" : "off"}</b></span><span>{Math.min(25, r.recentBuybacks.length)} rows · 30s</span></span>}>
        <BuybackFeed buybacks={r.recentBuybacks} now={now} limit={25} scroll />
      </Section>

      <Section title="Most active reward coins" action={<span className="num text-[11px] text-muted">{fmtNum(rewards.data.launches.length)} reward coins · {fmtNum(totalPayouts)} payouts · {fmtNum(stats.data.tokens.rewardLaunches)} reward launches · <Link href="/rewards" className="text-secondary hover:text-primary">USD view →</Link></span>}>
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
