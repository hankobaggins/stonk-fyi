import { getLaunches, getStats } from "@/lib/api";
import { getLaunchVelocity } from "@/lib/db";
import { fmtNum, fmtUsd, nowMs, shortAddr, timeAgo } from "@/lib/format";
import { ExplorerLink, KpiTile, ModePill, PageHeader, Section, TokenLink } from "@/components/ui";
import { CountBarChart, ShareBar } from "@/components/charts";
import { TradeLink } from "@/components/BuyButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launches" };

export default async function LaunchesPage() {
  const now = nowMs();
  const [launches, stats, vel] = await Promise.all([getLaunches({ pageSize: 100 }), getStats(), getLaunchVelocity(24).catch(() => null)]);
  const rows = launches.data.launches.slice(0, 50);
  const s = stats.data;

  // Launch velocity. Preferred: 24h of 5-minute platform snapshots (the launch ledger's total, or
  // the token index's total for older history; null after an upstream counter reset until half an
  // hour of readings exists past it). Fallback when the DB is absent or the figure is unavailable:
  // the newest 100 launches over their own time span — the ledger, not the token index, which lost
  // its launchlab tokens on 2026-09-18. The API caps pages at 100 and launches exceed 100/hour, so
  // that window is often under an hour; it is an estimate and labelled as one (span floored at
  // 5 minutes, never at 1h).
  const newest = launches.data.launches;
  const n = newest.length;
  const oldest = newest[n - 1]?.createdAt;
  const spanHours = oldest ? Math.max(5 / 60, (now - Date.parse(oldest)) / 3.6e6) : 1;
  const fallbackRate = n / spanHours;
  const perHour = new Map<string, number>();
  for (const t of newest) {
    const h = t.createdAt.slice(0, 13) + ":00:00Z";
    perHour.set(h, (perHour.get(h) ?? 0) + 1);
  }
  const fallbackSeries = [...perHour.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  const velocity = vel ? vel.hourly : fallbackSeries;
  const spanLabel = spanHours < 1 ? `${Math.round(spanHours * 60)} min` : `${spanHours.toFixed(1)}h`;
  const velSub = vel
    ? vel.reset
      ? `${fmtNum(vel.launches)} since StonkFun's counter reset ${timeAgo(vel.reset.ts, now)} · stonk.fyi snapshots · 5 min`
      : `${fmtNum(vel.launches)} over the last ${vel.hours.toFixed(0)}h · stonk.fyi snapshots · 5 min`
    : null;

  const modeSplit = [
    { name: "Reward mode", value: rows.filter((l) => l.mode === "reward").length },
    { name: "Standard mode", value: rows.filter((l) => l.mode === "standard").length },
  ];
  const padSplit = [
    { name: "LaunchLab", value: rows.filter((l) => l.launchpad === "launchlab").length },
    { name: "Raydium CPMM", value: rows.filter((l) => l.launchpad === "raydium").length },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Launches" sub={<><span className="num">{fmtNum(launches.data.pagination.total)}</span> launches on the ledger · graduation at <span className="num">{fmtUsd(Number(s.config.graduationMarketCapUsd))}</span> market cap</>} />

      <div className="kpis">
        {vel ? (
          <KpiTile label="Launches / hour" value={fmtNum(vel.perHour, 1)} sub={velSub ?? ""} />
        ) : (
          <KpiTile label="Launches / hour" value={`~${fmtNum(fallbackRate)}`} sub={`estimate: newest ${n} launches span ${spanLabel}`} />
        )}
        <KpiTile label="Total launches" value={fmtNum(launches.data.pagination.total)} sub={`${fmtNum(s.tokens.total)} in StonkFun's token index`} />
        <KpiTile label="Graduated" value={fmtNum(s.tokens.graduated)} sub={`${((s.tokens.graduated / Math.max(1, launches.data.pagination.total)) * 100).toFixed(1)}% of all launches`} />
        <KpiTile label="About to graduate" value={fmtNum(s.tokens.aboutToGraduate)} sub={`≥ ${fmtUsd(Number(s.config.aboutToGraduateMarketCapUsd))} market cap`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title={vel ? (vel.reset ? `Launches per hour since ${timeAgo(vel.reset.ts, now)}` : "Launches per hour, last 24h") : `Launches per hour, newest ${n} launches`} className="lg:col-span-2" action={<span className="num text-[11px] text-muted">{vel ? "stonk.fyi snapshots · hourly · 5 min" : "estimate"}</span>}>
          <CountBarChart data={velocity} name="Launches" tick="hour" height={220} />
        </Section>
        <div className="grid gap-4 content-start">
          <Section title="Mode" action={<span className="num text-[11px] text-muted">last 50</span>}><ShareBar data={modeSplit} fmt="count" /></Section>
          <Section title="Launchpad" action={<span className="num text-[11px] text-muted">last 50</span>}><ShareBar data={padSplit} fmt="count" /></Section>
        </div>
      </div>

      <Section title="Launch ledger" action={<span className="num text-[11px] text-muted">newest first · {rows.length} rows · StonkFun · 30s</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Token</th>
                <th>Pair</th>
                <th>Mode</th>
                <th>Launchpad</th>
                <th className="r">Start MC</th>
                <th className="r">Creator</th>
                <th className="r"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.mint}>
                  <td className="text-muted num">{timeAgo(l.createdAt, now)}</td>
                  <td>
                    <TokenLink mint={l.mint}>
                      <span className="font-medium">{l.symbol}</span> <span className="text-muted text-xs">{l.name}</span>
                    </TokenLink>
                  </td>
                  <td className="text-secondary">{l.quote.symbol}</td>
                  <td><ModePill mode={l.mode} bps={l.transferFee?.bps} /></td>
                  <td className="text-secondary">{l.launchpad}</td>
                  <td className="r num">{fmtUsd(l.startMarketCapUsd)}</td>
                  <td className="r">{l.creator ? <ExplorerLink addr={l.creator} label={`${shortAddr(l.creator)} ↗`} /> : "—"}</td>
                  <td className="r"><TradeLink mint={l.mint} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
