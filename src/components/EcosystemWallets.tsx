"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtNum, timeAgo } from "@/lib/format";

// The ecosystem's holder base: distinct wallets holding at least one StonkFun reward coin, from the daily
// reward-coin census (lib/wallets.ts runCoinCensus). Every one of these wallets is paid a quote asset by
// the coins it holds. Plain rows in, no functions across the boundary.

export type CensusPoint = { ts: string; wallets: number; coins: number; coinsTotal: number; slotsCovered: number; slotsTotal: number; coinsFailed: number; firstError: string | null; durationMs: number | null };

const WINDOWS = [
  { h: 24, label: "24h" },
  { h: 168, label: "7d" },
  { h: 720, label: "30d" },
];
const MIN_COVERAGE = 0.8;
const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));
const fmtTs = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function EcosystemWallets({ runs, now }: { runs: CensusPoint[]; now: number }) {
  const series = runs.map((r) => ({ ts: Date.parse(r.ts), wallets: r.wallets }));
  const last = series[series.length - 1];
  const first = series[0];
  const latest = runs[runs.length - 1];
  const coverage = latest ? (latest.slotsCovered / Math.max(1, latest.slotsTotal)) * 100 : 0;

  const change = (hours: number) => {
    if (!last || !first) return null;
    if (last.ts - first.ts < hours * 3.6e6 * MIN_COVERAGE) return null;
    const target = last.ts - hours * 3.6e6;
    let base = first;
    for (const p of series) if (p.ts <= target) base = p;
    const abs = last.wallets - base.wallets;
    return { abs, pct: base.wallets > 0 ? (abs / base.wallets) * 100 : null, at: base.ts };
  };

  return (
    <div>
      <div className="kpis">
        <div className="kpi min-w-0">
          <div className="label">Wallets holding a reward coin</div>
          <div className="mt-2 text-[30px] leading-tight font-medium num truncate tracking-tight">{last ? fmtNum(last.wallets) : "—"}</div>
          <div className="mt-1.5 text-xs text-secondary num">{last ? <>census {timeAgo(new Date(last.ts).toISOString(), now)} · at least</> : "no census yet"}</div>
        </div>
        {WINDOWS.map((w) => {
          const c = change(w.h);
          const cls = !c ? "text-muted" : c.abs > 0 ? "text-up" : c.abs < 0 ? "text-down" : "text-muted";
          return (
            <div key={w.h} className="kpi min-w-0">
              <div className="label">{w.label} change</div>
              <div className={`mt-2 text-[30px] leading-tight font-medium num truncate tracking-tight ${cls}`}>{c ? signed(c.abs) : <span className="text-base">collecting</span>}</div>
              <div className="mt-1.5 text-xs text-secondary num">{c ? <>{c.pct !== null ? `${c.pct > 0 ? "+" : ""}${c.pct.toFixed(2)}%` : "—"} · vs {fmtTs(c.at)}</> : `needs about ${Math.ceil((w.h * MIN_COVERAGE) / 24)} day${w.h > 30 ? "s" : ""} of daily census history`}</div>
            </div>
          );
        })}
      </div>

      {series.length > 1 && (
        <div className="mt-5">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ecoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={fmtTs} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tickFormatter={(n: number) => fmtNum(n)} tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} />
              <Tooltip
                content={({ label, payload }) =>
                  payload?.length ? (
                    <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
                      <div className="text-muted">{new Date(Number(label)).toLocaleString("en-US", { timeZone: "UTC" })} UTC</div>
                      <div className="num">{fmtNum(payload[0].value as number)} wallets</div>
                    </div>
                  ) : null
                }
              />
              <Area type="monotone" dataKey="wallets" name="Wallets" stroke="var(--series-1)" strokeWidth={2} fill="url(#ecoFill)" dot={false} activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted num">
        <span>
          {latest ? (
            <>
              Covers the {fmtNum(latest.coins)} largest of {fmtNum(latest.coinsTotal)} reward coins by holder count — {coverage.toFixed(0)}% of StonkFun&apos;s {fmtNum(latest.slotsTotal)} holder-slots — so the true figure is higher
              {latest.durationMs ? ` · ${(latest.durationMs / 1000).toFixed(0)}s` : ""}
              {latest.coinsFailed ? <span className="text-caution"> · incomplete: {latest.coinsFailed} coins unread ({latest.firstError})</span> : null}
            </>
          ) : null}
        </span>
        <span>Helius on-chain · stonk.fyi census · daily</span>
      </div>
    </div>
  );
}
