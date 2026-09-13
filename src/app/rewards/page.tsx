import Link from "next/link";
import { getRevenueHistory } from "@/lib/api";
import { getRewardsOverview } from "@/lib/rewards";
import { fmtNum, fmtUsd, nowMs, shortAddr, timeAgo } from "@/lib/format";
import { ExplorerLink, KpiTile, PageHeader, Section, TokenLink } from "@/components/ui";
import { CountBarChart, HBarChart } from "@/components/charts";
import { TradeLink } from "@/components/BuyButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Holder rewards" };

export default async function RewardsPage() {
  const now = nowMs();
  const [o, history] = await Promise.all([getRewardsOverview(), getRevenueHistory()]);
  const days = history.data.days;
  const notionalLifetime = days.reduce((s, d) => s + d.dailyHoldersRevenue, 0);
  const holdersSeries = days.map((d) => ({ date: d.date, value: d.dailyHoldersRevenue }));
  // Per-UTC-day payouts (canonical here; Flywheel links to this card). Notional: StonkFun's USD at payout time.
  const todayHolders = days[days.length - 1]?.dailyHoldersRevenue ?? 0;
  const yesterdayHolders = days[days.length - 2]?.dailyHoldersRevenue ?? null;
  const holders7 = days.slice(-7).reduce((s, d) => s + d.dailyHoldersRevenue, 0);
  const holdersPrev7 = days.slice(-14, -7).reduce((s, d) => s + d.dailyHoldersRevenue, 0);
  const holders7Delta = holdersPrev7 ? ((holders7 - holdersPrev7) / holdersPrev7) * 100 : null;
  const fullDays = days.slice(1, -1).map((d) => d.dailyHoldersRevenue);
  const avgHoldersDay = fullDays.length ? fullDays.reduce((a, b) => a + b, 0) / fullDays.length : 0;
  const totalRevenue = days.reduce((s, d) => s + d.dailyRevenue, 0);
  const holdersShare = totalRevenue ? (notionalLifetime / totalRevenue) * 100 : 0;
  const top = o.rows.slice(0, 50);
  const topQuotes = o.byQuote.filter((q) => q.usdNow !== null).slice(0, 12).map((q) => ({ name: q.symbol, value: q.usdNow ?? 0 }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Holder rewards"
        sub={<>Reward-mode coins pay their trading fees to holders in the coin&apos;s quote asset. <span className="num">{fmtNum(o.coins)}</span> reward coins on the ledger · <span className="num">StonkFun snapshot {timeAgo(o.generatedAt, now)}</span></>}
      >
        <Link href="/tokens?mode=reward&by=apr3" className="num text-xs text-secondary hover:text-primary whitespace-nowrap">APR per coin → Tokens &amp; yield</Link>
      </PageHeader>

      <div className="kpis">
        <KpiTile label="Paid out, at today's prices" value={fmtUsd(o.usdNow)} sub={`${(o.usdPricedShare * 100).toFixed(0)}% of payouts priced · Jupiter · 5 min`} />
        <KpiTile label="Paid out, at payout time" value={fmtUsd(notionalLifetime)} sub="StonkFun's USD at each payout · lifetime" />
        <KpiTile label="Payouts" value={fmtNum(o.payouts)} sub={`${fmtNum(o.coinsPaying)} of ${fmtNum(o.coins)} coins have paid`} />
        <KpiTile label="Holders across reward coins" value={fmtNum(o.holdersPaid)} sub="sum of each coin's holder count · not unique wallets" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Paid to holders per day (USD at payout)" className="lg:col-span-2" action={<span className="num text-[11px] text-muted">StonkFun revenue history · per UTC day · 5 min</span>}>
          <div className="kpis !border-b-0 !pb-3 mb-1">
            <KpiTile label="Today (UTC)" value={fmtUsd(todayHolders)} delta={yesterdayHolders ? ((todayHolders - yesterdayHolders) / yesterdayHolders) * 100 : null} sub="vs yesterday · partial day" />
            <KpiTile label="Last 7 days" value={fmtUsd(holders7)} delta={holders7Delta} sub="vs prior 7d" />
            <KpiTile label="Average full day" value={fmtUsd(avgHoldersDay)} sub={`over ${fullDays.length} complete days`} />
            <KpiTile label="Lifetime" value={fmtUsd(notionalLifetime)} sub={`${holdersShare.toFixed(0)}% of all fee revenue`} />
          </div>
          <CountBarChart data={holdersSeries} name="To holders" fmt="usd" height={220} />
          <p className="text-xs text-muted mt-2.5">Summed across every reward coin at StonkFun&apos;s USD value at payout time, not marked to today&apos;s prices. Today is partial until 00:00 UTC.</p>
        </Section>
        <Section title="Lifetime by quote asset" action={<span className="num text-[11px] text-muted">today&apos;s prices</span>}>
          <HBarChart data={topQuotes} valueLabel="Paid out" />
        </Section>
      </div>

      <Section title="Top reward coins by lifetime payout" action={<span className="num text-[11px] text-muted">top {top.length} of {fmtNum(o.coins)} · StonkFun rewards · 60s · Jupiter · 5 min</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th className="r">#</th><th>Token</th><th>Paid in</th><th className="r">Distributed</th><th className="r">USD now</th><th className="r">Payouts</th><th className="r">Holders</th><th className="r">Last payout</th><th className="r"></th></tr></thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.mint}>
                  <td className="r text-muted num">{i + 1}</td>
                  <td>
                    <TokenLink mint={r.mint}>
                      {r.symbol ? <><span className="font-medium">{r.symbol}</span> <span className="text-muted text-xs">{r.name}</span></> : <span className="font-mono text-xs">{shortAddr(r.mint, 6)}</span>}
                    </TokenLink>
                  </td>
                  <td className="text-secondary">{r.quote.symbol}</td>
                  <td className="r num">{fmtNum(r.distributedTokens, r.distributedTokens < 100 ? 4 : 0)} {r.quote.symbol}</td>
                  <td className="r num">{r.usdNow !== null ? fmtUsd(r.usdNow) : <span className="text-muted">unpriced</span>}</td>
                  <td className="r num">{fmtNum(r.payoutCount)}</td>
                  <td className="r num">{fmtNum(r.holderCount)}</td>
                  <td className="r num text-muted">{timeAgo(r.lastPayoutAt, now)}</td>
                  <td className="r"><TradeLink mint={r.mint} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid lg:grid-cols-[3fr_2fr] gap-4">
        <Section title="Recent payouts" action={<span className="num text-[11px] text-muted">last {o.recent.length} · StonkFun rewards · 120s</span>}>
          <div className="table-wrap max-h-[420px] overflow-y-auto">
            <table className="data">
              <thead><tr><th>When</th><th>Token</th><th className="r">Amount</th><th className="r">USD now</th><th className="r">Holders</th><th className="r">Tx</th></tr></thead>
              <tbody>
                {o.recent.map((d) => (
                  <tr key={d.signature}>
                    <td className="text-muted num">{timeAgo(d.distributedAt, now)}</td>
                    <td><TokenLink mint={d.mint}>{d.symbol ?? <span className="font-mono text-xs">{shortAddr(d.mint, 5)}</span>}</TokenLink></td>
                    <td className="r num">{fmtNum(d.amountTokens, d.amountTokens < 100 ? 4 : 0)} {d.quoteSymbol ?? ""}</td>
                    <td className="r num">{d.usdNow !== null ? fmtUsd(d.usdNow) : "—"}</td>
                    <td className="r num">{fmtNum(d.holderCount)}</td>
                    <td className="r"><ExplorerLink addr={d.signature} kind="tx" label={`${shortAddr(d.signature, 4)} ↗`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Quote assets" action={<span className="num text-[11px] text-muted">{Math.min(60, o.byQuote.length)} rows</span>}>
          <div className="table-wrap max-h-[420px] overflow-y-auto">
            <table className="data">
              <thead><tr><th>Asset</th><th className="r">Coins</th><th className="r">Payouts</th><th className="r">Distributed</th><th className="r">USD now</th></tr></thead>
              <tbody>
                {o.byQuote.slice(0, 60).map((q) => (
                  <tr key={q.mint}>
                    <td>{q.symbol}</td>
                    <td className="r num">{fmtNum(q.coins)}</td>
                    <td className="r num">{fmtNum(q.payouts)}</td>
                    <td className="r num">{fmtNum(q.tokens, q.tokens < 100 ? 4 : 0)}</td>
                    <td className="r num">{q.usdNow !== null ? fmtUsd(q.usdNow) : <span className="text-muted">unpriced</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <p className="text-xs text-muted leading-relaxed max-w-[100ch]">
        Two USD figures appear because payouts are made in many assets whose prices move: &quot;at payout time&quot; is what StonkFun recorded when it paid (a platform-wide daily total); &quot;at today&apos;s prices&quot; re-values the same native amounts with Jupiter now, and a few quote assets have no Jupiter price and stay unpriced. Payout counts and amounts are on-chain.{" "}
        <Link href="/about#yield" className="text-secondary hover:text-primary">Methodology →</Link>
      </p>
    </div>
  );
}
