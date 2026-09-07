import { getLaunches, getStats, getTokens } from "@/lib/api";
import { fmtNum, fmtUsd, nowMs, shortAddr, timeAgo } from "@/lib/format";
import { ExplorerLink, KpiTile, ModePill, PageHeader, Section, TokenLink } from "@/components/ui";
import { CountBarChart, ShareBar } from "@/components/charts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launches" };

export default async function LaunchesPage() {
  const now = nowMs();
  const [launches, stats, newest] = await Promise.all([getLaunches({ pageSize: 50 }), getStats(), getTokens({ sort: "newest", pageSize: 100 })]);
  const rows = launches.data.launches;
  const s = stats.data;

  // Launch velocity from the newest 100 tokens (createdAt) — a rolling window, not full history.
  const perHour = new Map<string, number>();
  for (const t of newest.data.tokens) {
    const h = t.createdAt.slice(0, 13) + ":00:00Z";
    perHour.set(h, (perHour.get(h) ?? 0) + 1);
  }
  const velocity = [...perHour.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  const oldest = newest.data.tokens[newest.data.tokens.length - 1]?.createdAt;
  const spanHours = oldest ? Math.max(1, (now - Date.parse(oldest)) / 3.6e6) : 1;

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
      <PageHeader title="Launches" sub={`${fmtNum(launches.data.pagination.total)} launches on the ledger · graduation at ${fmtUsd(Number(s.config.graduationMarketCapUsd))} market cap`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Launches / hour" value={(newest.data.tokens.length / spanHours).toFixed(1)} sub={`last ${newest.data.tokens.length} tokens over ${spanHours.toFixed(1)}h`} />
        <KpiTile label="Total launches" value={fmtNum(launches.data.pagination.total)} sub={`${fmtNum(s.tokens.total)} with live pools`} />
        <KpiTile label="Graduated" value={fmtNum(s.tokens.graduated)} sub={`${((s.tokens.graduated / Math.max(1, launches.data.pagination.total)) * 100).toFixed(1)}% of all launches`} />
        <KpiTile label="About to graduate" value={fmtNum(s.tokens.aboutToGraduate)} sub={`≥ ${fmtUsd(Number(s.config.aboutToGraduateMarketCapUsd))} market cap`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Launches per hour (rolling window)" className="lg:col-span-2">
          <CountBarChart data={velocity.map((v) => ({ date: v.date, value: v.value }))} name="Launches" />
        </Section>
        <div className="space-y-4">
          <Section title="Mode (last 50)"><ShareBar data={modeSplit} fmt="count" /></Section>
          <Section title="Launchpad (last 50)"><ShareBar data={padSplit} fmt="count" /></Section>
        </div>
      </div>

      <Section title="Launch ledger (newest first)">
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
                <th>Creator</th>
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
                  <td>{l.quote.symbol}</td>
                  <td><ModePill mode={l.mode} bps={l.transferFee?.bps} /></td>
                  <td className="text-secondary">{l.launchpad}</td>
                  <td className="r num">{fmtUsd(l.startMarketCapUsd)}</td>
                  <td>{l.creator ? <ExplorerLink addr={l.creator} label={shortAddr(l.creator)} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
