import Link from "next/link";
import { fmtNum, fmtUsd, nowMs, shortAddr, timeAgo } from "@/lib/format";
import { CountBarChart, StackedCountChart } from "@/components/charts";
import { ExplorerLink, KpiTile, Section, TokenLink } from "@/components/ui";
import { TradeLink } from "@/components/BuyButton";
import MethodStrip from "@/components/MethodStrip";
import ShareCard from "@/components/ShareCard";
import type { CommunityCoin, CommunityOverview, CommunityTraction } from "@/lib/community";
import type { DistributionRow } from "@/lib/rewards";

// /rewards?mode=community (§6p): what StonkFun Community Mode coins have sent to holders of their quote tokens, and
// to their own holders, from this site's split of StonkFun's ledger (lib/community.ts). Server component.
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const amt = (n: number) => fmtNum(n, n < 100 ? 2 : 0);

export default function CommunityRewards({ ov, coins, traction, recent, version }: { ov: CommunityOverview; coins: CommunityCoin[]; traction: CommunityTraction; recent: DistributionRow[]; version: number }) {
  const now = nowMs();
  if (ov.status === "no-db") return <p className="card p-5 text-sm text-secondary">Community Mode figures come from this site&apos;s own records of which coins are in the mode, which this deployment doesn&apos;t have (no database). They are on <Link className="text-primary underline" href="https://stonk.fyi/rewards?mode=community">stonk.fyi</Link>.</p>;
  if (ov.status === "db-error") return <p className="card p-5 text-sm text-caution">Couldn&apos;t read the Community Mode records ({ov.error}). The rest of the site is unaffected; try again in a minute.</p>;
  if (ov.status === "empty") return <p className="card p-5 text-sm text-secondary">Collecting: the worker records Community Mode coins as it sees them (every 5 minutes, and every reward coin that trades each hour). The first figures appear within 15 minutes of it starting.</p>;

  const today = traction.days[traction.days.length - 1];
  const prev = traction.days[traction.days.length - 2];
  const shareToday = today && today.launches ? (today.community / today.launches) * 100 : null;
  const sharePrev = prev && prev.launches ? (prev.community / prev.launches) * 100 : null;
  const launched = traction.days.reduce((s, d) => s + d.community, 0);
  const rewardLaunched = traction.days.reduce((s, d) => s + d.launches, 0);
  const total = ov.toQuoteUsd + ov.toCoinUsd;
  const quoteShare = total > 0 ? (ov.toQuoteUsd / total) * 100 : null;
  const read = ov.totalsAt ? `split read ${timeAgo(ov.totalsAt, now)}` : "";
  const cards = ov.byQuote.filter((q) => (q.toQuoteUsd ?? 0) > 0).slice(0, 3);

  return (
    <div className="space-y-5">
      <div className="kpis">
        <KpiTile label="Sent to quote-token holders" value={<span className="text-[var(--series-2)]">{fmtUsd(ov.toQuoteUsd)}</span>} sub={`${quoteShare !== null ? `${quoteShare.toFixed(0)}% of community payouts` : "33% of each payout"} · ${ov.byQuote.length} quote tokens`} />
        <KpiTile label="Sent to coin holders" value={fmtUsd(ov.toCoinUsd)} sub="the other 67% · today's prices" />
        <KpiTile label="Community coins" value={fmtNum(ov.coins)} sub={`${fmtNum(ov.active)} in the mode now · ${fmtNum(ov.graduated)} graduated${ov.switched ? ` · ${fmtNum(ov.switched)} switched in` : ""}`} />
        <KpiTile label="Share of reward launches" value={shareToday !== null ? `${shareToday.toFixed(0)}%` : "—"} sub={`today (UTC)${sharePrev !== null ? ` · ${sharePrev.toFixed(0)}% the day before` : ""} · ${fmtNum(launched)} of ${fmtNum(rewardLaunched)} since ${traction.days[0] ? day(traction.days[0].date) : "launch"}`} />
      </div>

      <MethodStrip
        lead="33% of every holder payout from a Community Mode coin goes to holders of its quote token; this page splits StonkFun's payout totals by that rule."
        note={`${read}${ov.synthetic ? " · offline sample" : ""}`}
        href="/about#community-mode"
      >
        <div className="text-[13px] text-secondary leading-relaxed max-w-[100ch] space-y-2 pb-3">
          <p>StonkFun reports one payout total per coin. For a Community Mode coin it holds both shares (checked on-chain: payouts filed under a community coin went partly to wallets that hold none of it, and hold its quote token). So the split here is StonkFun&apos;s rule applied to that total, not two separately reported figures.</p>
          <p>Coins can switch into the mode after launch. This site re-reads the mode of every reward coin that trades, every hour, and counts a switcher&apos;s payouts from the moment it saw the switch, so its quote-holder share can be understated by up to an hour of payouts, never overstated. USD is at today&apos;s prices (Jupiter; STONK at StonkFun&apos;s), re-valued every 15 minutes.</p>
        </div>
      </MethodStrip>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Sent to quote-token holders per day" action={<span className="num text-[11px] text-muted">stonk.fyi hourly reads · today&apos;s prices</span>}>
          {traction.paidPerDay.length ? <CountBarChart data={traction.paidPerDay} name="To quote holders" fmt="usd" height={210} /> : <p className="text-xs text-muted py-10 text-center">Per-day bars start after the first full day of hourly reads.</p>}
        </Section>
        <Section title="Reward launches per day" action={<span className="num text-[11px] text-muted">StonkFun token index · mode at launch</span>}>
          <StackedCountChart data={traction.days.map((d) => ({ date: d.date, a: d.launches - d.community, b: d.community }))} names={["Plain reward mode", "Community Mode"]} height={210} />
        </Section>
      </div>

      <Section title="Sent to holders of each quote token" action={<span className="num text-[11px] text-muted">{ov.byQuote.length} quote tokens · {read}</span>}>
        <div className="table-wrap max-h-[520px] overflow-y-auto">
          <table className="data">
            <thead><tr><th className="r">#</th><th className="st2">Quote token</th><th className="r">Sent to its holders</th><th className="r p3">In tokens</th><th className="r">To coin holders</th><th className="r">Coins</th><th className="r p3">Payouts</th><th className="r p3">Last payout</th><th className="r">Card</th></tr></thead>
            <tbody>
              {ov.byQuote.slice(0, 100).map((q, i) => (
                <tr key={q.quoteMint}>
                  <td className="r text-muted num">{i + 1}</td>
                  <td className="st2"><Link href={`/pairs/${q.quoteMint}`} className="font-medium hover:underline">{q.quoteSymbol}</Link></td>
                  <td className="r num text-[var(--series-2)]">{q.toQuoteUsd !== null ? fmtUsd(q.toQuoteUsd) : <span className="text-muted">unpriced</span>}</td>
                  <td className="r num text-secondary p3">{amt(q.toQuoteTokens)} {q.quoteSymbol}</td>
                  <td className="r num">{q.toCoinUsd !== null ? fmtUsd(q.toCoinUsd) : "—"}</td>
                  <td className="r num">{fmtNum(q.coins)}{q.active < q.coins ? <span className="text-muted"> ({fmtNum(q.active)} now)</span> : null}</td>
                  <td className="r num p3">{fmtNum(q.payouts)}</td>
                  <td className="r num text-muted p3">{q.lastPayoutAt ? timeAgo(q.lastPayoutAt, now) : "—"}</td>
                  <td className="r"><a href={`/community-card/${q.quoteMint}`} target="_blank" rel="noopener" className="num text-xs text-secondary hover:text-primary">PNG ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-2.5">Payouts and last payout are the community coins&apos; lifetime counts from StonkFun&apos;s ledger, both shares together.</p>
      </Section>

      {cards.length > 0 && (
        <Section title="Share cards" action={<span className="num text-[11px] text-muted">1600×900 · any quote token: the PNG link in its row</span>}>
          <div className="grid lg:grid-cols-2 gap-5">
            <ShareCard src={`/community-card?v=${version}`} name="stonk-community-mode.png" alt="Community Mode: sent to quote-token holders, all tokens" />
            {cards.map((q) => (
              <ShareCard key={q.quoteMint} src={`/community-card/${q.quoteMint}?v=${version}`} name={`stonk-community-${q.quoteSymbol.replace(/[^A-Za-z0-9]/g, "")}.png`} alt={`Community Mode: sent to ${q.quoteSymbol} holders`} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Community coins by amount sent to quote-token holders" action={<span className="num text-[11px] text-muted">top {coins.length} of {fmtNum(ov.coins)}</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th className="r">#</th><th className="st2">Token</th><th>Pays</th><th className="r">To quote holders</th><th className="r">To coin holders</th><th className="p3">In the mode</th><th className="r p3">Payouts</th><th className="r p3">Holders</th><th className="r p3">Last payout</th><th className="r"></th></tr></thead>
            <tbody>
              {coins.map((c, i) => (
                <tr key={c.mint}>
                  <td className="r text-muted num">{i + 1}</td>
                  <td className="st2"><TokenLink mint={c.mint}>{c.symbol ? <><span className="font-medium">{c.symbol}</span> <span className="text-muted text-xs">{c.name}</span></> : <span className="font-mono text-xs">{shortAddr(c.mint, 6)}</span>}</TokenLink></td>
                  <td className="text-secondary">{c.quoteSymbol}</td>
                  <td className="r num text-[var(--series-2)]">{c.toQuoteUsd !== null ? fmtUsd(c.toQuoteUsd) : <span className="text-muted">unpriced</span>}</td>
                  <td className="r num">{c.toCoinUsd !== null ? fmtUsd(c.toCoinUsd) : "—"}</td>
                  <td className="p3 text-xs text-secondary">{c.shareBps === null ? <span className="text-muted">left the mode</span> : c.firstKind === "switch" ? <>switched in{c.switchedAt ? ` ${day(c.switchedAt)}` : ""}</> : "since launch"}</td>
                  <td className="r num p3">{fmtNum(c.payoutCount)}</td>
                  <td className="r num p3">{fmtNum(c.holderCount)}</td>
                  <td className="r num text-muted p3">{c.lastPayoutAt ? timeAgo(c.lastPayoutAt, now) : "—"}</td>
                  <td className="r"><TradeLink mint={c.mint} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-2.5">Payouts and holders are StonkFun&apos;s figures for the coin and include the quote-token holders it paid.</p>
      </Section>

      <Section title="Recent community payouts" action={<span className="num text-[11px] text-muted">from StonkFun&apos;s last {25} payouts · 120s</span>}>
        {recent.length ? (
          <div className="table-wrap max-h-[360px] overflow-y-auto">
            <table className="data">
              <thead><tr><th>When</th><th>Token</th><th className="r">Amount</th><th className="r">USD now</th><th className="r">Wallets</th><th className="r">Tx</th></tr></thead>
              <tbody>
                {recent.map((d) => (
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
        ) : (
          <p className="text-xs text-muted py-6 text-center">None of StonkFun&apos;s last 25 payouts was from a Community Mode coin. Plain reward coins pay far more often; check back in a minute.</p>
        )}
        <p className="text-xs text-muted mt-2.5">Each payout goes either to the coin&apos;s holders or to holders of its quote token; StonkFun&apos;s feed doesn&apos;t say which, the transaction does.</p>
      </Section>
    </div>
  );
}
