import Link from "next/link";
import { getRevenue, getRevenueHistory, getStats, getTokens } from "@/lib/api";
import { cumulative, fmtNum, fmtUsd, nowMs, timeAgo } from "@/lib/format";
import { KpiTile, Section } from "@/components/ui";
import { CountBarChart, CumulativeChart, RevenueChart, ShareBar } from "@/components/charts";
import { getRevenuePace } from "@/lib/db";
import TokenTable from "@/components/TokenTable";
import BuybackFeed from "@/components/BuybackFeed";

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform" };

export default async function PlatformPage() {
  const now = nowMs();
  const [stats, revenue, history, topVol, topMc, pace] = await Promise.all([
    getStats(),
    getRevenue(),
    getRevenueHistory(),
    getTokens({ sort: "volume", pageSize: 10 }),
    getTokens({ sort: "marketCap", pageSize: 10 }),
    getRevenuePace(48).catch(() => null),
  ]);

  const s = stats.data;
  const r = revenue.data;
  const days = history.data.days;
  const last7 = days.slice(-7);
  const prev7 = days.slice(-14, -7);
  const sum = (xs: typeof days) => xs.reduce((a, d) => a + d.dailyRevenue, 0);
  const rev7 = sum(last7);
  const rev7Delta = prev7.length ? ((rev7 - sum(prev7)) / sum(prev7)) * 100 : null;
  const today = days[days.length - 1];

  // Today's pace: revenue so far this UTC day ÷ hours elapsed, extrapolated to 24h. Two pace
  // estimates are shown because they answer different questions: "today so far" is the official
  // daily figure on its way to closing, "last 6h" is where the flywheel is right now.
  const utcHoursElapsed = Math.max(0.25, (now - Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())) / 3.6e6);
  const todayRev = today?.dailyRevenue ?? 0;
  const projectedToday = (todayRev / utcHoursElapsed) * 24;
  const paceFrom6h = pace?.last6h != null ? pace.last6h * 4 : null;
  const yesterday = days[days.length - 2]?.dailyRevenue ?? null;

  const cumRevenue = cumulative(days, (d) => d.dailyRevenue);
  const revenueSeries = days.map((d) => ({ date: d.date, holders: d.dailyHoldersRevenue, protocol: d.dailyProtocolRevenue }));

  const burnShare = Object.entries(r.burns.bySource)
    .map(([name, v]) => ({ name, value: v.valueUsd }))
    .sort((a, b) => b.value - a.value);

  const gradRate = s.tokens.total ? (s.tokens.graduated / s.tokens.total) * 100 : 0;
  const buybackShare = r.revenue.totalRevenueUsd ? (r.revenue.totalBuybackUsd / r.revenue.totalRevenueUsd) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Platform overview</h1>
          <p className="text-sm text-muted mt-0.5">
            StonkFun launchpad on Solana mainnet · StonkFun snapshot {timeAgo(stats.meta.generatedAt, now)}
          </p>
        </div>
      </div>

      <div className="kpis">
        <KpiTile label="Total market cap" value={fmtUsd(s.tokens.totalMarketCapUsd)} sub={`${fmtNum(s.tokens.total)} live tokens`} />
        <KpiTile label="24h volume" value={fmtUsd(s.tokens.totalVolume24hUsd)} sub={`${fmtNum(s.tokens.rewardLaunches)} reward-mode launches`} />
        <KpiTile label="Revenue (7d)" value={fmtUsd(rev7)} delta={rev7Delta} sub="vs prior 7d" />
        <KpiTile label="Revenue today (UTC)" value={fmtUsd(today?.dailyRevenue)} sub={`${utcHoursElapsed.toFixed(1)}h in · ${fmtUsd(today?.dailyHoldersRevenue)} to holders`} />
        <KpiTile label="Lifetime revenue" value={fmtUsd(s.revenue.totalRevenueUsd)} sub={`since ${history.data.start}`} />
        <KpiTile label="Buybacks (lifetime)" value={fmtUsd(r.revenue.totalBuybackUsd)} sub={`${buybackShare.toFixed(0)}% of revenue · ${fmtNum(r.revenue.buybackCount)} txs`} />
        <KpiTile label="Burned (USD at burn)" value={fmtUsd(s.burns.totalValueUsdAtBurn)} sub={`${fmtNum(s.burns.burnCount)} burns · ${fmtNum(r.burns.mintCount)} mints`} />
        <KpiTile label="Graduated" value={fmtNum(s.tokens.graduated)} sub={`${gradRate.toFixed(1)}% of live · ${s.tokens.aboutToGraduate} about to`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Revenue pace" className="lg:col-span-1" action={<span className="num text-xs text-muted">stonk.fyi snapshots · 5 min</span>}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Last hour</dt><dd className="num text-right">{pace?.lastHour != null ? fmtUsd(pace.lastHour) : <span className="text-muted">collecting</span>}</dd>
            <dt className="text-muted">Last 6h</dt><dd className="num text-right">{pace?.last6h != null ? fmtUsd(pace.last6h) : <span className="text-muted">collecting</span>}</dd>
            <dt className="text-muted">Last 24h, rolling</dt><dd className="num text-right">{pace?.last24h != null ? fmtUsd(pace.last24h) : <span className="text-muted">collecting</span>}</dd>
            <dt className="text-muted pt-2 border-t border-border">Today on pace for</dt>
            <dd className="num text-right pt-2 border-t border-border">
              <span className="text-primary font-medium">{fmtUsd(projectedToday)}</span>
              {yesterday ? <span className={`ml-2 ${projectedToday >= yesterday ? "text-up" : "text-down"}`}>{projectedToday >= yesterday ? "▲" : "▼"} {Math.abs(((projectedToday - yesterday) / yesterday) * 100).toFixed(0)}% vs yesterday</span> : null}
            </dd>
            <dt className="text-muted">At last-6h pace</dt><dd className="num text-right">{paceFrom6h != null ? fmtUsd(paceFrom6h) : <span className="text-muted">collecting</span>} <span className="text-muted">/ 24h</span></dd>
          </dl>
          <div className="text-xs text-muted mt-3">
            &quot;Today&quot; is StonkFun&apos;s UTC day, {utcHoursElapsed.toFixed(1)}h in, extrapolated flat. The last-6h figure is the flywheel&apos;s current speed; they diverge when
            activity is ramping or fading.
          </div>
        </Section>
        <Section title="Hourly fee revenue, last 48h" className="lg:col-span-2" action={<span className="num text-xs text-muted">UTC · stonk.fyi snapshots · 5 min</span>}>
          {pace && pace.hourly.length >= 2 ? (
            <CountBarChart data={pace.hourly} name="Revenue" fmt="usd" tick="hour" height={220} />
          ) : (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted">Collecting: hourly bars appear after the first two hours of snapshots.</div>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Daily fee revenue (USD)" className="lg:col-span-2" action={<Link href="/flywheel" className="text-xs text-muted hover:text-primary">Flywheel →</Link>}>
          <RevenueChart data={revenueSeries} />
        </Section>
        <Section title="Cumulative revenue">
          <CumulativeChart data={cumRevenue} height={260} />
        </Section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Burn value by source">
          <ShareBar data={burnShare} />
          <div className="mt-3 text-xs text-muted">
            Buyback burns dominate; flywheel and reward burns are the top-token buy-and-burn program and transfer-tax sweeps.
          </div>
        </Section>
        <Section title="Recent buybacks" className="lg:col-span-2" action={<span className="text-xs text-muted num">last {timeAgo(r.revenue.lastBuybackAt, now)}</span>}>
          <BuybackFeed buybacks={r.recentBuybacks} now={now} limit={8} />
        </Section>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <Section title="Top by 24h volume" action={<Link href="/tokens?sort=volume" className="text-xs text-muted hover:text-primary">All tokens →</Link>}>
          <TokenTable tokens={topVol.data.tokens} now={now} compact />
        </Section>
        <Section title="Top by market cap" action={<Link href="/tokens?sort=marketCap" className="text-xs text-muted hover:text-primary">All tokens →</Link>}>
          <TokenTable tokens={topMc.data.tokens} now={now} compact />
        </Section>
      </div>
    </div>
  );
}
