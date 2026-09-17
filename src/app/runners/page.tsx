import Link from "next/link";
import { getLaunchCohort, getRunnerBoard, type LaunchCohort, type RunnerBoard } from "@/lib/runners";
import { collapseLedger, lineLabel, RUNNER_LINES, SEED_AGE_H, type RunnerRow, type WindowCounts } from "@/lib/runner-math";
import { fmtDate, fmtNum, fmtUsd, nowMs, timeAgo } from "@/lib/format";
import { Empty, KpiTile, PageHeader, Section, TokenLink } from "@/components/ui";
import { TradeLink } from "@/components/BuyButton";
import MethodStrip from "@/components/MethodStrip";

export const dynamic = "force-dynamic";
export const metadata = { title: "Runners", description: "StonkFun tokens crossing $1M, $5M, $10M, $25M, $50M and $100M market cap, counted once each, from the moment they cross." };

// How tight the crossing time is: the crossing lies between this site's previous reading of the token and
// the reading that saw the new peak.
function precision(r: RunnerRow): string {
  if (!r.reachedAt) return "";
  if (!r.afterTs) return "first reading";
  const min = (Date.parse(r.reachedAt) - Date.parse(r.afterTs)) / 6e4;
  if (min <= 7) return "±5 min";
  if (min <= 65) return "±1 h";
  if (min <= 24 * 60 + 30) return `±${Math.round(min / 60)} h`;
  return `±${Math.round(min / 1440)} d`;
}

function windowNote(w: WindowCounts, board: RunnerBoard): string {
  const label = w.hours === 24 ? "24h" : "7d";
  return board.historyHours >= w.hours ? label : `${label} · since go-live (${fmtNum(board.historyHours, board.historyHours < 10 ? 1 : 0)} h)`;
}

export default async function RunnersPage() {
  const now = nowMs();
  const [board, cohort1, cohort7] = await Promise.all([
    getRunnerBoard().catch((e: Error) => ({ error: e.message })),
    getLaunchCohort(24).catch(() => null),
    getLaunchCohort(24 * 7).catch(() => null),
  ]);
  const err = board && "error" in board ? board.error : null;
  const b: RunnerBoard | null = board && !("error" in board) ? board : null;
  const live = !!b && !!b.since;
  const ledger = b ? collapseLedger(b.ledger) : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Runners" sub={<>Tokens that crossed <span className="num">$1M</span>, <span className="num">$5M</span>, <span className="num">$10M</span>, <span className="num">$25M</span>, <span className="num">$50M</span> or <span className="num">$100M</span> market cap, counted once per token per line, from the moment they cross. Peaks at StonkFun pricing.</>}>
        <span className="num text-[11px] text-muted">stonk.fyi snapshots · 5 min</span>
      </PageHeader>

      {b && (
        <div className="kpis md:grid-cols-4">
          <KpiTile label="Crossed $1M, 24h" value={live ? fmtNum(b.d1.crossed[0].count) : "—"} sub={live ? windowNote(b.d1, b) : "collecting"} />
          <KpiTile label="Crossed $1M, 7d" value={live ? fmtNum(b.d7.crossed[0].count) : "—"} sub={live ? windowNote(b.d7, b) : "collecting"} />
          <KpiTile label="Crossed $5M, 7d" value={live ? fmtNum(b.d7.crossed[1].count) : "—"} sub={live ? windowNote(b.d7, b) : "collecting"} />
          <KpiTile label="Biggest runner, 7d" value={b.d7.top[0] ? fmtUsd(b.d7.top[0].peakUsd, { compact: true }) : "—"} sub={b.d7.top[0] ? `${b.d7.top[0].symbol} · peak so far` : "no crossing yet"} />
        </div>
      )}

      <Section title="Crossings by line" action={<span className="num text-[11px] text-muted">{b && live ? `since ${fmtDate(b.since)} · ${fmtNum(b.rows)} rows` : "stonk.fyi snapshots"}</span>}>
        {!b && err && <Empty>The crossing ledger could not be read just now ({err}). Check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → runners.</Empty>}
        {!b && !err && <Empty>This page needs the site&apos;s snapshot store (Postgres), which this deployment does not have.</Empty>}
        {b && !live && <Empty>Collecting: the ledger is seeded on the worker&apos;s next tick, and counts start from that moment. Nothing that happened before it is counted.</Empty>}
        {b && live && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Crossed</th>
                    <th className="r">{windowNote(b.d1, b)}</th>
                    <th className="r">{windowNote(b.d7, b)}</th>
                  </tr>
                </thead>
                <tbody>
                  {RUNNER_LINES.map((line, i) => (
                    <tr key={line}>
                      <td className="num">{lineLabel(line)}+</td>
                      <td className={`r num ${b.d1.crossed[i].count ? "" : "text-muted"}`}>{b.d1.crossed[i].count}</td>
                      <td className={`r num ${b.d7.crossed[i].count ? "" : "text-muted"}`}>{b.d7.crossed[i].count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted mt-2">Cumulative: a token that crossed $5M is also counted at $1M. A token counts at each line once, ever.</p>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Peak so far</th>
                    <th className="r">entered {windowNote(b.d1, b)}</th>
                    <th className="r">entered {windowNote(b.d7, b)}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.d7.bands.map((band, i) => (
                    <tr key={band.label}>
                      <td className="num">{band.label}</td>
                      <td className={`r num ${b.d1.bands[i].count ? "" : "text-muted"}`}>{b.d1.bands[i].count}</td>
                      <td className={`r num ${band.count ? "" : "text-muted"}`}>{band.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted mt-2">Tokens that crossed $1M inside the window, grouped by the highest line they have reached to date. Bands add up to the $1M+ count.</p>
            </div>
          </div>
        )}
        <MethodStrip
          lead="A crossing is counted the first time a token's lifetime peak market cap is seen at or above a line. Peaks only rise, so nothing is counted twice."
          note={live ? `card: /runners-card?window=7d` : undefined}
          href="/about#runners"
        >
          <div className="method-body">
            <p>Every five minutes the worker reads the 100 most-traded tokens and the 100 largest by market cap (the 500 most-traded once an hour, every token once a day) and compares each token&apos;s lifetime peak market cap, as StonkFun reports it, with the lines it has already been recorded at. A new line gets one row with the reading time; the crossing itself lies between that reading and the site&apos;s previous reading of the token (the ± figure in the ledger). A token that runs to $1M has volume, so it is normally in view within minutes; the daily walk is the backstop.</p>
            <p>The ledger was seeded when the rail went live: every crossing that had already happened was recorded without a time and is never counted in a window. A token the site has never snapshotted before, older than {SEED_AGE_H} hours, is treated the same way when it first appears, so the daily walk cannot mistake old history for a runner.</p>
            <p>Market caps are StonkFun&apos;s USD figures at their pricing. Peak is a lifetime high, not the market cap now; the ledger shows both at the time of the crossing.</p>
          </div>
        </MethodStrip>
      </Section>

      <Section title="Runners, last 7 days" action={<span className="num text-[11px] text-muted">newest crossing first · {ledger.length} rows</span>}>
        {!b || !live || ledger.length === 0 ? (
          <Empty>{live ? "No token has crossed a line since the ledger went live." : "Collecting."}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="st1">#</th>
                  <th className="st2">Token</th>
                  <th>Pair</th>
                  <th className="r">Crossed</th>
                  <th className="r">Market cap then</th>
                  <th className="r">Peak so far</th>
                  <th className="r">When</th>
                  <th className="r p3">Launched</th>
                  <th className="r"></th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r, i) => (
                  <tr key={`${r.mint}-${r.thresholdUsd}`}>
                    <td className="st1 num text-muted">{i + 1}</td>
                    <td className="st2">
                      <TokenLink mint={r.mint}>
                        <span className="font-medium">{r.symbol ?? r.mint.slice(0, 6)}</span> {r.name && <span className="text-muted text-xs">{r.name}</span>}
                      </TokenLink>
                    </td>
                    <td className="text-secondary">{r.quoteSymbol ?? "—"}</td>
                    <td className="r num"><span className="text-up">{lineLabel(r.thresholdUsd)}</span>{r.lines.length > 1 && <span className="text-muted text-[11px]"> via {r.lines.slice(0, -1).map(lineLabel).join(", ")}</span>}</td>
                    <td className="r num">{fmtUsd(r.marketCapUsd, { compact: true })}</td>
                    <td className="r num">{fmtUsd(r.peakUsd, { compact: true })}</td>
                    <td className="r num text-secondary">{timeAgo(r.reachedAt, now)} <span className="text-muted">{precision(r)}</span></td>
                    <td className="r num text-muted p3">{r.createdAt ? timeAgo(r.createdAt, now) : "—"}</td>
                    <td className="r"><TradeLink mint={r.mint} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <CohortSection c1={cohort1} c7={cohort7} now={now} />
    </div>
  );
}

// The other framing: tokens launched inside the window, by the peak they have reached so far. It is what
// "since date X only N tokens reached $5M" posts count, and it is biased against young cohorts — a token
// launched an hour ago has had an hour to run — which is why it sits below the crossings.
function CohortSection({ c1, c7, now }: { c1: LaunchCohort | null; c7: LaunchCohort | null; now: number }) {
  const list = c7?.tokens.slice(0, 30) ?? [];
  return (
    <Section title="Launched in the window, by peak so far" action={<span className="num text-[11px] text-muted">stonk.fyi token index · every token daily, active ones every 5 min</span>}>
      {!c7 ? (
        <Empty>Needs the site&apos;s token index (Postgres), which this deployment does not have.</Empty>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Peak reached</th>
                  <th className="r">launched 24h</th>
                  <th className="r">launched 7d</th>
                </tr>
              </thead>
              <tbody>
                {RUNNER_LINES.map((line, i) => (
                  <tr key={line}>
                    <td className="num">{lineLabel(line)}+</td>
                    <td className={`r num ${c1?.counts[i].count ? "" : "text-muted"}`}>{c1 ? c1.counts[i].count : "—"}</td>
                    <td className={`r num ${c7.counts[i].count ? "" : "text-muted"}`}>{c7.counts[i].count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-muted mt-2">Tokens launched inside the window whose lifetime peak so far is at or above the line. This framing favours older cohorts: a token launched today has had today to run. The crossings above are the fair comparison.</p>
          </div>
          <div className="table-wrap">
            {list.length === 0 ? (
              <Empty>No token launched in the last 7 days has reached $1M yet.</Empty>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th className="st1">#</th>
                    <th className="st2">Token</th>
                    <th>Pair</th>
                    <th className="r">Peak so far</th>
                    <th className="r">Launched</th>
                    <th className="r"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((t, i) => (
                    <tr key={t.mint}>
                      <td className="st1 num text-muted">{i + 1}</td>
                      <td className="st2">
                        <TokenLink mint={t.mint}>
                          <span className="font-medium">{t.symbol ?? t.mint.slice(0, 6)}</span> {t.name && <span className="text-muted text-xs">{t.name}</span>}
                        </TokenLink>
                      </td>
                      <td className="text-secondary">{t.quoteSymbol ?? "—"}</td>
                      <td className="r num">{fmtUsd(t.peakUsd, { compact: true })}</td>
                      <td className="r num text-muted">{timeAgo(t.createdAt, now)}</td>
                      <td className="r"><TradeLink mint={t.mint} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {c7.oldestRead && <p className="text-[11px] text-muted mt-2">Peaks as of each token&apos;s last read; the oldest read in this list is {timeAgo(c7.oldestRead, now)}.</p>}
          </div>
        </div>
      )}
    </Section>
  );
}
