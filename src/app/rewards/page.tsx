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
  const top = o.rows.slice(0, 50);
  const topQuotes = o.byQuote.filter((q) => q.usdNow !== null).slice(0, 12).map((q) => ({ name: q.symbol, value: q.usdNow ?? 0 }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Holder rewards"
        sub={`Reward-mode coins pay their trading fees to holders in the coin's quote asset. ${fmtNum(o.coins)} reward coins on the ledger · StonkFun snapshot ${timeAgo(o.generatedAt, now)}`}
      />

      <div className="kpis">
        <KpiTile label="Paid out, at today's prices" value={fmtUsd(o.usdNow)} sub={`${(o.usdPricedShare * 100).toFixed(0)}% of payouts priced · Jupiter · 5 min`} />
        <KpiTile label="Paid out, at payout time" value={fmtUsd(notionalLifetime)} sub="StonkFun's USD at each payout · lifetime" />
        <KpiTile label="Payouts" value={fmtNum(o.payouts)} sub={`${fmtNum(o.coinsPaying)} of ${fmtNum(o.coins)} coins have paid`} />
        <KpiTile label="Holders across reward coins" value={fmtNum(o.holdersPaid)} sub="sum of each coin&apos;s current holder count" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Paid to holders per day (USD at payout)" className="lg:col-span-2" action={<span className="num text-xs text-muted">UTC · StonkFun revenue history · 5 min</span>}>
          <CountBarChart data={holdersSeries} name="To holders" fmt="usd" height={240} />
        </Section>
        <Section title="Lifetime by quote asset (today's prices)">
          <HBarChart data={topQuotes} valueLabel="Paid out" />
        </Section>
      </div>

      <Section title="Top reward coins by lifetime payout" action={<span className="num text-xs text-muted">top {top.length} of {fmtNum(o.coins)} · valued at today&apos;s prices</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th className="r">#</th><th>Token</th><th>Paid in</th><th className="r">Distributed</th><th className="r">USD now</th><th className="r">Payouts</th><th className="r">Holders</th><th className="r">Last payout</th><th className="r">Trade</th></tr></thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.mint}>
                  <td className="r text-muted num">{i + 1}</td>
                  <td>
                    <TokenLink mint={r.mint}>
                      {r.symbol ? <><span className="font-medium">{r.symbol}</span> <span className="text-muted text-xs">{r.name}</span></> : <span className="font-mono text-xs">{shortAddr(r.mint, 6)}</span>}
                    </TokenLink>
                  </td>
                  <td>{r.quote.symbol}</td>
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

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Recent payouts" action={<span className="num text-xs text-muted">last {o.recent.length} · StonkFun rewards · 120s</span>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Token</th><th className="r">Amount</th><th className="r">USD now</th><th className="r">Holders</th><th>Tx</th></tr></thead>
              <tbody>
                {o.recent.map((d) => (
                  <tr key={d.signature}>
                    <td className="text-muted num">{timeAgo(d.distributedAt, now)}</td>
                    <td><TokenLink mint={d.mint}>{d.symbol ?? <span className="font-mono text-xs">{shortAddr(d.mint, 5)}</span>}</TokenLink></td>
                    <td className="r num">{fmtNum(d.amountTokens, d.amountTokens < 100 ? 4 : 0)} {d.quoteSymbol ?? ""}</td>
                    <td className="r num">{d.usdNow !== null ? fmtUsd(d.usdNow) : "—"}</td>
                    <td className="r num">{fmtNum(d.holderCount)}</td>
                    <td><ExplorerLink addr={d.signature} kind="tx" label={shortAddr(d.signature, 5)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Quote assets">
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

      <p className="text-xs text-muted">
        Two USD figures because the API gives two things: StonkFun reports the dollar value of holder payouts only as a platform-wide daily total (the &quot;at payout
        time&quot; number and the chart), and per-coin payouts only in native units, which are valued here at Jupiter&apos;s current price for each quote asset. They
        will not match: prices move, and a few quote assets have no Jupiter price and stay unpriced. Payout counts and amounts are on-chain;{" "}
        <Link href="/about" className="underline underline-offset-2 hover:text-primary">methodology →</Link>
      </p>
    </div>
  );
}
