"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtNum, timeAgo } from "@/lib/format";

// Distinct wallets holding at least one quote asset in the selected issuer categories, from the
// wallet-census histogram (lib/wallets.ts): each run stores wallets-per-category-mask, so any
// combination of issuers is answered client-side without another query.

export type CensusRunView = { ts: string; hist: number[] };
export type CensusMetaView = { ts: string; mintsOk: number; mintsFailed: number; accounts: number; firstError: string | null; durationMs: number | null };

const ISSUERS = [
  { bit: 1, label: "xStocks" },
  { bit: 2, label: "Backpack" },
  { bit: 4, label: "Pre-stocks" },
  { bit: 8, label: "Tessera" },
];
const PRESETS = [
  { mask: 15, label: "All issuers" },
  { mask: 3, label: "Stocks (xStocks + Backpack)" },
  { mask: 12, label: "Pre-IPO (Pre-stocks + Tessera)" },
];
const WINDOWS = [
  { h: 24, label: "24h" },
  { h: 168, label: "7d" },
  { h: 720, label: "30d" },
];
const MIN_COVERAGE = 0.8;

const count = (hist: number[], subset: number) => hist.reduce((a, w, mask) => a + ((mask & subset) !== 0 ? w : 0), 0);
const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));
const fmtTs = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function WalletCensus({ runs, latest, quoteAssets, now }: { runs: CensusRunView[]; latest: CensusMetaView | null; quoteAssets: number; now: number }) {
  const [subset, setSubset] = useState(15);
  const toggle = (bit: number) => setSubset((s) => (s === bit ? s : s ^ bit)); // never empty

  const series = runs.map((r) => ({ ts: Date.parse(r.ts), wallets: count(r.hist, subset) }));
  const last = series[series.length - 1];
  const first = series[0];
  const from = (hours: number) => (first ? fmtTs(first.ts + Math.ceil((hours * MIN_COVERAGE) / 24) * 864e5) : "soon");

  const change = (hours: number) => {
    if (!last || !first) return null;
    const target = last.ts - hours * 3.6e6;
    if (last.ts - first.ts < hours * 3.6e6 * MIN_COVERAGE) return null;
    let base = first;
    for (const p of series) if (p.ts <= target) base = p;
    const abs = last.wallets - base.wallets;
    return { abs, pct: base.wallets > 0 ? (abs / base.wallets) * 100 : null, at: base.ts };
  };

  return (
    <div>
      <div className="filterbar flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button key={p.mask} type="button" onClick={() => setSubset(p.mask)} aria-current={subset === p.mask}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {ISSUERS.map((i) => (
            <button key={i.bit} type="button" onClick={() => toggle(i.bit)} aria-current={(subset & i.bit) !== 0} aria-pressed={(subset & i.bit) !== 0}>
              {(subset & i.bit) !== 0 ? "☑" : "☐"} {i.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi min-w-0">
          <div className="label">Unique wallets</div>
          <div className="mt-2 text-[26px] leading-tight font-medium num truncate tracking-tight">{last ? fmtNum(last.wallets) : "—"}</div>
          <div className="mt-1.5 text-xs text-secondary num">{last ? <>census {timeAgo(new Date(last.ts).toISOString(), now)}</> : "no census yet"}</div>
        </div>
        {WINDOWS.map((w) => {
          const c = change(w.h);
          const cls = !c ? "text-muted" : c.abs > 0 ? "text-up" : c.abs < 0 ? "text-down" : "text-muted";
          return (
            <div key={w.h} className="kpi min-w-0">
              <div className="label">{w.label} change</div>
              <div className={`mt-2 text-[26px] leading-tight font-medium num truncate tracking-tight ${cls}`}>{c ? signed(c.abs) : <span className="text-base text-muted">from {from(w.h)}</span>}</div>
              <div className="mt-1.5 text-xs text-secondary num">{c ? <>{c.pct !== null ? `${c.pct > 0 ? "+" : ""}${c.pct.toFixed(2)}%` : "—"} · vs {fmtTs(c.at)} {new Date(c.at).toISOString().slice(11, 16)} UTC</> : `first census ${first ? fmtTs(first.ts) : "pending"}`}</div>
            </div>
          );
        })}
      </div>

      {series.length > 1 && (
        <div className="mt-5">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="walletFill" x1="0" y1="0" x2="0" y2="1">
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
              <Area type="monotone" dataKey="wallets" name="Wallets" stroke="var(--series-1)" strokeWidth={2} fill="url(#walletFill)" dot={false} activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted num">
        <span>
          {latest ? <>{latest.mintsOk} of {latest.mintsOk + latest.mintsFailed} quote assets counted · {fmtNum(latest.accounts)} token accounts with a balance{latest.durationMs ? ` · ${(latest.durationMs / 1000).toFixed(0)}s` : ""}</> : `${quoteAssets} quote assets tracked`}
          {latest?.mintsFailed ? <span className="text-caution"> · incomplete: {latest.firstError}</span> : null}
        </span>
        <span>Helius on-chain · stonk.fyi census · every few hours</span>
      </div>
    </div>
  );
}
