import Link from "next/link";
import { getRevenueHistory } from "@/lib/api";
import { getRewardsOverview, parseRewardsMode, type RewardsMode } from "@/lib/rewards";
import { getCommunityCoins, getCommunityOverview, getCommunitySet, getCommunityTraction } from "@/lib/community";
import { fmtNum, fmtUsd, nowMs, shortAddr, timeAgo } from "@/lib/format";
import { ExplorerLink, KpiTile, PageHeader, Section, TokenLink } from "@/components/ui";
import { CountBarChart, HBarChart } from "@/components/charts";
import { TradeLink } from "@/components/BuyButton";
import RewardsLookup from "@/components/RewardsLookup";
import CommunityRewards from "@/components/CommunityRewards";
import { pageMetadata } from "@/lib/page-meta";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("rewards", "Holder rewards");

// Three views (StonkFun's ask, 2026-10-03): every reward coin, Community Mode coins (33% of each holder payout goes to
// holders of the coin's quote token, §6p), and plain reward coins.
const MODES: { key: RewardsMode; label: string }[] = [
  { key: "all", label: "All rewards" },
  { key: "community", label: "Community mode" },
  { key: "plain", label: "Plain reward mode" },
];

export default async function RewardsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const now = nowMs();
  const mode = parseRewardsMode((await searchParams).mode);
  const cmSet = await getCommunitySet();
  const [o, history, cm, cmCoins, traction] = await Promise.all([
    getRewardsOverview(mode, cmSet),
    mode === "all" ? getRevenueHistory() : Promise.resolve(null),
    getCommunityOverview(),
    mode === "community" ? getCommunityCoins(50, null) : Promise.resolve([]),
    mode === "community" ? getCommunityTraction(30) : Promise.resolve({ days: [], paidPerDay: [] }),
  ]);
  const days = history?.data.days ?? [];
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
  const plain = mode === "plain";
  const cmReady = cm.status === "ok";
  const sub =
    mode === "community"
      ? <>Community Mode coins pay 33% of their holder rewards to holders of the coin&apos;s quote token and 67% to their own holders. <span className="num">{fmtNum(cm.coins)}</span> community coins · <span className="num">since {cm.firstAt ? new Date(cm.firstAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "Oct 2"}</span></>
      : plain
        ? <>Reward coins outside Community Mode: all of each payout goes to the coin&apos;s own holders. <span className="num">{fmtNum(o.coins)}</span> coins · <span className="num">StonkFun snapshot {timeAgo(o.generatedAt, now)}</span></>
        : <>Reward-mode coins pay their trading fees to holders in the coin&apos;s quote asset. <span className="num">{fmtNum(o.coins)}</span> reward coins on the ledger · <span className="num">StonkFun snapshot {timeAgo(o.generatedAt, now)}</span></>;

  return (
    <div className="space-y-5">
      <PageHeader title="Holder rewards" sub={sub}>
        <Link href="/tokens?mode=reward&by=apr3" className="num text-xs text-secondary hover:text-primary whitespace-nowrap">APR per coin → Tokens &amp; yield</Link>
      </PageHeader>

      <section id="check" className="card anchor p-5 sm:p-6">
        <div className="grid lg:grid-cols-[1fr_1.15fr] gap-x-8 gap-y-4 items-center">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">What has your wallet been paid?</h2>
            <p className="text-[13px] text-secondary mt-1.5 max-w-[60ch]">
              Paste a wallet: every StonkFun reward payout it has received, read from the chain, in total and by asset, with a card to share. Rewards are sent to
              holders automatically; there is nothing to claim.
            </p>
          </div>
          <RewardsLookup big />
        </div>
      </section>

      <nav aria-label="Reward mode" className="flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <Link
            key={m.key}
            href={m.key === "all" ? "/rewards" : `/rewards?mode=${m.key}`}
            scroll={false}
            aria-current={mode === m.key ? "page" : undefined}
            className={`num text-xs rounded-full border px-3.5 py-1.5 ${mode === m.key ? "border-border-strong bg-surface-2 text-primary" : "border-border text-secondary hover:text-primary"}`}
          >
            {m.label}
            {m.key === "community" && cmReady ? <span className="text-[var(--series-2)]"> · {fmtUsd(cm.toQuoteUsd)} to quote holders</span> : null}
          </Link>
        ))}
      </nav>

      {mode === "community" ? (
        <CommunityRewards ov={cm} coins={cmCoins} traction={traction} recent={o.recent} version={Math.floor(now / 300_000)} />
      ) : (
        <>
          <div className="kpis">
            <KpiTile label="Paid out, at today's prices" value={fmtUsd(o.usdNow)} sub={`${(o.usdPricedShare * 100).toFixed(0)}% of payouts priced · Jupiter · 5 min`} />
            {plain ? (
              <KpiTile label="Community mode, excluded" value={cmReady ? fmtUsd(cm.toQuoteUsd + cm.toCoinUsd) : "—"} sub={cmReady ? `${fmtNum(cm.coins)} coins · see Community mode` : "needs this site's records"} />
            ) : (
              <KpiTile label="Paid out, at payout time" value={fmtUsd(notionalLifetime)} sub="StonkFun's USD at each payout · lifetime" />
            )}
            <KpiTile label="Payouts" value={fmtNum(o.payouts)} sub={`${fmtNum(o.coinsPaying)} of ${fmtNum(o.coins)} coins have paid`} />
            <KpiTile label="Holders across reward coins" value={fmtNum(o.holdersPaid)} sub="sum of each coin's holder count · not unique wallets" />
          </div>

          {!plain && cmReady && cm.toQuoteUsd > 0 && (
            <Link href="/rewards?mode=community" scroll={false} className="card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px] hover:bg-surface-2">
              <span className="pill cm">community mode</span>
              <span>
                <span className="num text-[var(--series-2)]">{fmtUsd(cm.toQuoteUsd)}</span> sent to holders of {cm.byQuote.length} quote tokens by {fmtNum(cm.coins)} community coins
                {cm.byQuote[0] ? <span className="text-secondary"> · most to {cm.byQuote[0].quoteSymbol} holders ({fmtUsd(cm.byQuote[0].toQuoteUsd)})</span> : null}
              </span>
              <span className="ml-auto num text-xs text-secondary">View →</span>
            </Link>
          )}

          <div className="grid lg:grid-cols-3 gap-4">
            {plain ? (
              <Section title="Paid to holders per day" className="lg:col-span-2">
                <p className="text-[13px] text-secondary py-6 max-w-[70ch]">StonkFun&apos;s per-day holder payout figure is one platform-wide number covering both modes, so it can&apos;t be split here. It is on <Link href="/rewards" scroll={false} className="text-primary underline">All rewards</Link>; Community Mode&apos;s own per-day figure is on <Link href="/rewards?mode=community" scroll={false} className="text-primary underline">Community mode</Link>.</p>
              </Section>
            ) : (
              <Section title="Paid to holders per day (USD at payout)" className="lg:col-span-2" action={<span className="num text-[11px] text-muted">StonkFun revenue history · per UTC day · 5 min</span>}>
                <div className="kpis !border-b-0 !pb-3 mb-1">
                  <KpiTile label="Today (UTC)" value={fmtUsd(todayHolders)} delta={yesterdayHolders ? ((todayHolders - yesterdayHolders) / yesterdayHolders) * 100 : null} sub="vs yesterday · partial day" />
                  <KpiTile label="Last 7 days" value={fmtUsd(holders7)} delta={holders7Delta} sub="vs prior 7d" />
                  <KpiTile label="Average full day" value={fmtUsd(avgHoldersDay)} sub={`over ${fullDays.length} complete days`} />
                  <KpiTile label="Lifetime" value={fmtUsd(notionalLifetime)} sub={`${holdersShare.toFixed(0)}% of all fee revenue`} />
                </div>
                <CountBarChart data={holdersSeries} name="To holders" fmt="usd" height={220} />
                <p className="text-xs text-muted mt-2.5">Summed across every reward coin at StonkFun&apos;s USD value at payout time, not marked to today&apos;s prices, both modes together (a Community Mode coin&apos;s payouts to quote-token holders are in it). Today is partial until 00:00 UTC.</p>
              </Section>
            )}
            <Section title="Lifetime by quote asset" action={<span className="num text-[11px] text-muted">today&apos;s prices</span>}>
              <HBarChart data={topQuotes} valueLabel="Paid out" />
            </Section>
          </div>

          <Section title={plain ? "Top plain reward coins by lifetime payout" : "Top reward coins by lifetime payout"} action={<span className="num text-[11px] text-muted">top {top.length} of {fmtNum(o.coins)} · StonkFun rewards · 60s · Jupiter · 5 min</span>}>
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
                        {r.cm && !plain ? <span className="pill cm ml-2" title={r.cm.shareBps ? `Community Mode: ${r.cm.shareBps / 100}% of payouts go to quote-token holders` : "Was in Community Mode"}>community</span> : null}
                        {r.cm && plain ? <span className="text-muted text-xs ml-2">before it switched to community mode</span> : null}
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
            {!plain && cmReady && <p className="text-xs text-muted mt-2.5">A community coin&apos;s figures are its whole payout: 67% to its holders and 33% to holders of the token in &quot;Paid in&quot;.</p>}
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
                        <td><TokenLink mint={d.mint}>{d.symbol ?? <span className="font-mono text-xs">{shortAddr(d.mint, 5)}</span>}</TokenLink>{d.cm ? <span className="pill cm ml-2">community</span> : null}</td>
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
        </>
      )}

      <p className="text-xs text-muted leading-relaxed max-w-[100ch]">
        {mode === "community"
          ? <>StonkFun reports one payout total per coin; the split between the coin&apos;s holders and its quote token&apos;s holders is its 33% rule applied to that total over the time the coin has been in Community Mode. USD is at today&apos;s prices (Jupiter; STONK at StonkFun&apos;s), re-valued every 15 minutes. Payout counts and amounts are on-chain.{" "}</>
          : <>Two USD figures appear because payouts are made in many assets whose prices move: &quot;at payout time&quot; is what StonkFun recorded when it paid (a platform-wide daily total); &quot;at today&apos;s prices&quot; re-values the same native amounts with Jupiter now, and a few quote assets have no Jupiter price and stay unpriced. Payout counts and amounts are on-chain.{plain ? " Plain view: each figure leaves out what a coin paid while in Community Mode (split every 15 minutes); payout and holder counts of a coin that switched in stay whole." : ""}{" "}</>}
        <Link href={mode === "community" ? "/about#community-mode" : "/about#yield"} className="text-secondary hover:text-primary">Methodology →</Link>
      </p>
    </div>
  );
}
