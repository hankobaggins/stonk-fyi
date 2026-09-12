import Link from "next/link";
import type { HolderHistory } from "@/lib/stonk-holders";
import { profileChange, PROFILE_EVERY_MIN } from "@/lib/stonk-holders";
import { fmtNum, fmtPrice, fmtUsd, timeAgo } from "@/lib/format";
import { KpiTile, Section } from "./ui";
import { SeriesAreaChart, ShareBar } from "./charts";

// The $STONK holder base from HolderScan's profile (CLAUDE.md §6h): who holds, how much, for how long, at what
// cost. Everything here is read by the worker and stored; the page never calls HolderScan. Dollar figures are
// StonkFun's market cap and price against HolderScan's counts and positions, and say so.

const HOLDERSCAN_URL = "https://holderscan.com/token/";

const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : n < 0 ? `−${fmtNum(-n)}` : "0");
const cls = (n: number | null | undefined) => (n === null || n === undefined ? "text-muted" : n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");
const days = (sec: number | null) => (sec === null ? "—" : sec >= 864e2 ? `${(sec / 864e2).toFixed(1)}d` : `${(sec / 3600).toFixed(0)}h`);

function DeltaChip({ n, label }: { n: number | null | undefined; label: string }) {
  if (n === null || n === undefined) return null;
  return <span className={cls(n)}>{signed(n)} <span className="text-muted">{label}</span></span>;
}

export default function HolderBase({ h, mint, marketCapUsd, priceUsd, now }: { h: HolderHistory; mint: string; marketCapUsd: number | null; priceUsd: number | null; now: number }) {
  const p = h.latest;
  const b = p.breakdowns;
  const s = p.stats;
  const w = p.wallets;
  const sb = p.supplyBreakdown;
  const cadence = PROFILE_EVERY_MIN >= 60 ? `every ${PROFILE_EVERY_MIN / 60} h` : `every ${PROFILE_EVERY_MIN} min`;
  const avgUsd = marketCapUsd && p.holders > 0 ? marketCapUsd / p.holders : null;
  const medianUsd = s?.medianPosition && priceUsd ? s.medianPosition * priceUsd : null;
  const over1k = profileChange(h.dayAgo, p, (x) => x.breakdowns?.over1k);
  const holders1d = p.deltas?.d1 ?? profileChange(h.dayAgo, p, (x) => x.holders)?.abs ?? null;

  const ladder: { label: string; pick: (x: NonNullable<typeof b>) => number }[] = [
    { label: "over $10", pick: (x) => x.over10 },
    { label: "over $100", pick: (x) => x.over100 },
    { label: "over $1K", pick: (x) => x.over1k },
    { label: "over $10K", pick: (x) => x.over10k },
    { label: "over $100K", pick: (x) => x.over100k },
    { label: "over $1M", pick: (x) => x.over1m },
  ];
  const tiers = b ? [{ name: "Shrimp", value: b.shrimp }, { name: "Crab", value: b.crab }, { name: "Fish", value: b.fish }, { name: "Dolphin", value: b.dolphin }, { name: "Whale", value: b.whale }] : null;
  const classes = w ? [{ name: "Diamond", value: w.diamond }, { name: "Gold", value: w.gold }, { name: "Silver", value: w.silver }, { name: "Bronze", value: w.bronze }, { name: "Wood", value: w.wood }, { name: "New", value: w.newHolders }] : null;
  const supplyByClass = sb ? [{ name: "Diamond", value: sb.diamond }, { name: "Gold", value: sb.gold }, { name: "Silver", value: sb.silver }, { name: "Bronze", value: sb.bronze }, { name: "Wood", value: sb.wood }] : null;
  const series = h.series.map((x) => ({ ts: x.ts, value: x.holders }));
  const series1k = h.series.filter((x) => x.over1k !== null).map((x) => ({ ts: x.ts, value: x.over1k as number }));
  const spanDays = series.length > 1 ? (series[series.length - 1].ts - series[0].ts) / 864e5 : 0;

  return (
    <Section
      title="Holder base"
      action={<span className="num text-xs text-muted">HolderScan · {cadence} · read {timeAgo(p.ts, now)} · <a href={`${HOLDERSCAN_URL}${mint}`} target="_blank" rel="noreferrer" className="hover:text-primary">HolderScan ↗</a></span>}
    >
      <div className="kpis">
        <KpiTile
          label="Holders"
          value={fmtNum(p.holders)}
          sub={<span className="flex flex-wrap gap-x-2.5"><DeltaChip n={p.deltas?.h1} label="1h" /><DeltaChip n={holders1d} label="24h" /><DeltaChip n={p.deltas?.d7} label="7d" /><DeltaChip n={p.deltas?.d30} label="30d" /></span>}
        />
        <KpiTile
          label="Average per holder"
          value={avgUsd !== null ? fmtUsd(avgUsd) : "—"}
          sub={medianUsd !== null ? <>median {fmtUsd(medianUsd)} · {fmtNum(s!.medianPosition!)} STONK</> : "market cap ÷ holders"}
        />
        <KpiTile
          label="Holders over $1K"
          value={b ? fmtNum(b.over1k) : "—"}
          sub={b ? <>{p.holders > 0 ? `${((b.over1k / p.holders) * 100).toFixed(0)}% of holders` : ""}{over1k ? <span className={cls(over1k.abs)}> · {signed(over1k.abs)} 24h</span> : <span className="text-muted"> · 24h after ~19h of readings</span>}</> : "no breakdown on this read"}
        />
        <KpiTile
          label="Average hold time"
          value={s ? days(s.avgTimeHeldSec) : "—"}
          sub={s?.retentionRate !== null && s?.retentionRate !== undefined ? `${(s.retentionRate * 100).toFixed(0)}% retention` : "not profiled yet"}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mt-5">
        <div>
          <div className="label mb-2">By value held · HolderScan valuation</div>
          {b ? (
            <table className="data w-full">
              <thead><tr><th>Holders</th><th className="r">Wallets</th><th className="r">Share</th><th className="r">24h</th></tr></thead>
              <tbody>
                {ladder.map((r) => {
                  const v = r.pick(b);
                  const c = profileChange(h.dayAgo, p, (x) => (x.breakdowns ? r.pick(x.breakdowns) : null));
                  return (
                    <tr key={r.label}>
                      <td className="text-secondary">{r.label}</td>
                      <td className="r num">{fmtNum(v)}</td>
                      <td className="r num text-muted">{p.holders > 0 ? `${((v / p.holders) * 100).toFixed(1)}%` : "—"}</td>
                      <td className={`r num ${cls(c?.abs)}`}>{c ? signed(c.abs) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <div className="text-xs text-muted">Not on this read.</div>}
        </div>
        <div className="space-y-5">
          {tiers && (
            <div>
              <div className="label mb-2">By size tier · all holders</div>
              <ShareBar data={tiers} fmt="count" />
            </div>
          )}
          {classes && (
            <div>
              <div className="label mb-2">By hold time · 1,000 largest wallets</div>
              <ShareBar data={classes} fmt="count" />
            </div>
          )}
          {supplyByClass && (
            <div>
              <div className="label mb-2">Their STONK, by hold time</div>
              <ShareBar data={supplyByClass} fmt="count" />
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs self-start">
          <dt className="text-muted">Top 10 wallets</dt><dd className="num text-right">{p.top10Share !== null ? `${(p.top10Share * 100).toFixed(1)}% of supply` : "—"}</dd>
          <dt className="text-muted">Top 100 wallets</dt><dd className="num text-right">{p.top100Share !== null ? `${(p.top100Share * 100).toFixed(1)}% of supply` : "—"}</dd>
          <dt className="text-muted">Gini</dt><dd className="num text-right">{s?.gini !== null && s?.gini !== undefined ? s.gini.toFixed(3) : "—"}</dd>
          <dt className="text-muted">HHI</dt><dd className="num text-right">{s?.hhi !== null && s?.hhi !== undefined ? s.hhi.toFixed(4) : "—"}</dd>
          <dt className="text-muted">Break-even price</dt><dd className="num text-right">{p.pnl?.breakEvenPrice ? `${fmtPrice(p.pnl.breakEvenPrice)}${priceUsd ? ` · now ${(priceUsd / p.pnl.breakEvenPrice).toFixed(2)}×` : ""}` : "—"}</dd>
          <dt className="text-muted">Unrealized PnL</dt><dd className={`num text-right ${cls(p.pnl?.unrealizedPnlUsd)}`}>{p.pnl?.unrealizedPnlUsd !== null && p.pnl?.unrealizedPnlUsd !== undefined ? `${p.pnl.unrealizedPnlUsd < 0 ? "−" : "+"}${fmtUsd(Math.abs(p.pnl.unrealizedPnlUsd))}` : "—"}</dd>
          <dt className="text-muted">Realized PnL</dt><dd className={`num text-right ${cls(p.pnl?.realizedPnlUsd)}`}>{p.pnl?.realizedPnlUsd !== null && p.pnl?.realizedPnlUsd !== undefined ? `${p.pnl.realizedPnlUsd < 0 ? "−" : "+"}${fmtUsd(Math.abs(p.pnl.realizedPnlUsd))}` : "—"}</dd>
          {p.errors.length > 0 && (<><dt className="text-muted">Missing on this read</dt><dd className="text-right text-caution">{p.errors.map((e) => e.split(":")[0]).join(", ")}</dd></>)}
        </dl>
      </div>

      {series.length > 1 && (
        <div className={`grid ${series1k.length > 1 ? "lg:grid-cols-2" : ""} gap-4 mt-6`}>
          <div>
            <div className="flex items-baseline justify-between mb-1"><div className="label">Holders</div><span className="num text-xs text-muted">hourly · {spanDays < 1 ? `${(spanDays * 24).toFixed(0)}h` : `${spanDays.toFixed(0)}d`} of readings</span></div>
            <SeriesAreaChart data={series} name="Holders" fmt="count" height={200} series={0} />
          </div>
          {series1k.length > 1 && (
            <div>
              <div className="flex items-baseline justify-between mb-1"><div className="label">Holders over $1K</div><span className="num text-xs text-muted">hourly</span></div>
              <SeriesAreaChart data={series1k} name="Holders over $1K" fmt="count" height={200} series={2} />
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted mt-4">
        HolderScan counts every wallet with a STONK balance on any venue and values it at its own price at read time; average per holder is StonkFun&apos;s market cap divided by that count, which a few large wallets pull up — the median position is the typical holder. Hold-time classes and their supply cover the 1,000 largest wallets only; PnL is HolderScan&apos;s FIFO estimate. Top-wallet shares include pools. <Link href="/about#holderbase" className="underline underline-offset-2 hover:text-primary">Method →</Link>
      </p>
    </Section>
  );
}
