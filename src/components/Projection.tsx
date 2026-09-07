"use client";

import { useState } from "react";

type Inputs = {
  price: number;
  supply: number;
  marketCap: number;
  dailyRevenue: number;
  buybackShare: number;
  volume24h: number;
  quoteDepthUsd: number | null;
  poolVolume24h: number | null;
};

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`);
const num = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));
const px = (n: number) => `$${n.toFixed(4)}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

// Two bracketing models of what the buyback flywheel alone does to price over a horizon.
//  floor:   market cap held constant, price = mcap / (supply − tokens burned)      (near-guaranteed)
//  ceiling: every buyback dollar is a net buy nobody sells into, through a constant-product
//           pool with the live quote-side depth: price × (1 + B/R)^2                 (upper bound)
// Everything else — the other ~99% of order flow — is deliberately not modeled.
function project(i: Inputs, growthPct: number, days: number, depthOverride: number | null) {
  const g = growthPct / 100;
  let rev = 0;
  for (let d = 1; d <= days; d++) rev += i.dailyRevenue * Math.pow(1 + g, d);
  const buybacks = rev * i.buybackShare;
  const burned = buybacks / i.price;
  const floor = i.marketCap / (i.supply - burned);
  const depth = depthOverride ?? i.quoteDepthUsd;
  const ceiling = depth ? i.price * Math.pow(1 + buybacks / depth, 2) : null;
  return { rev, buybacks, burned, supplyCut: (burned / i.supply) * 100, floor, ceiling, depth };
}

export default function Projection({ inputs }: { inputs: Inputs }) {
  const [growth, setGrowth] = useState(10);
  const [days, setDays] = useState(7);
  const [depth, setDepth] = useState<number | null>(null);
  const r = project(inputs, growth, days, depth);
  const scenarios = [0, 5, 10, 20, 35].map((g) => ({ g, ...project(inputs, g, days, depth) }));
  const buybackVsVol = inputs.volume24h ? (inputs.dailyRevenue * inputs.buybackShare) / inputs.volume24h : null;

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-4 text-xs">
        <label className="block">
          <span className="text-muted">Revenue growth per day</span>
          <span className="float-right num text-primary">{growth}%</span>
          <input type="range" min={-20} max={50} step={1} value={growth} onChange={(e) => setGrowth(Number(e.target.value))} className="w-full mt-1 accent-[var(--accent)]" />
        </label>
        <label className="block">
          <span className="text-muted">Horizon</span>
          <span className="float-right num text-primary">{days} days</span>
          <input type="range" min={1} max={30} step={1} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full mt-1 accent-[var(--accent)]" />
        </label>
        <label className="block">
          <span className="text-muted">Quote-side pool depth</span>
          <span className="float-right num text-primary">{r.depth ? usd(r.depth) : "—"}{depth === null && inputs.quoteDepthUsd ? " (live)" : ""}</span>
          <input
            type="range" min={100_000} max={10_000_000} step={50_000}
            value={r.depth ?? 1_000_000}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="w-full mt-1 accent-[var(--accent)]"
          />
          {depth !== null && inputs.quoteDepthUsd && (
            <button type="button" onClick={() => setDepth(null)} className="text-muted hover:text-primary underline underline-offset-2 mt-0.5">reset to live</button>
          )}
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label={`Buybacks over ${days}d`} value={usd(r.buybacks)} sub={`${usd(r.rev)} revenue × ${(inputs.buybackShare * 100).toFixed(0)}%`} />
        <Tile label="STONK removed" value={num(r.burned)} sub={`${r.supplyCut.toFixed(2)}% of supply`} />
        <Tile label="Floor (supply-only)" value={px(r.floor)} sub={pct((r.floor / inputs.price - 1) * 100)} accent="up" />
        <Tile label="Ceiling (AMM, no sellers)" value={r.ceiling ? px(r.ceiling) : "—"} sub={r.ceiling ? pct((r.ceiling / inputs.price - 1) * 100) : "needs pool depth"} accent="up" />
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Revenue growth / day</th>
              <th className="r">{days}d revenue</th>
              <th className="r">Buybacks</th>
              <th className="r">Supply cut</th>
              <th className="r">Floor</th>
              <th className="r">Ceiling</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.g} className={s.g === growth ? "bg-surface-2" : ""}>
                <td className="num">{s.g}%</td>
                <td className="r num">{usd(s.rev)}</td>
                <td className="r num">{usd(s.buybacks)}</td>
                <td className="r num">{s.supplyCut.toFixed(2)}%</td>
                <td className="r num">{px(s.floor)} <span className="text-muted">{pct((s.floor / inputs.price - 1) * 100)}</span></td>
                <td className="r num">{s.ceiling ? <>{px(s.ceiling)} <span className="text-muted">{pct((s.ceiling / inputs.price - 1) * 100)}</span></> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-secondary leading-relaxed space-y-1">
        <p>
          Starting point: {px(inputs.price)}, {num(inputs.supply)} circulating, {usd(inputs.dailyRevenue)}/day platform revenue (7-day average), {(inputs.buybackShare * 100).toFixed(0)}% of it bought back and burned
          {buybackVsVol !== null && <> — about <span className="text-primary num">{(buybackVsVol * 100).toFixed(1)}%</span> of STONK&apos;s daily volume</>}.
        </p>
        <p>
          <span className="text-primary">Floor</span> assumes the market holds market cap flat and the only effect is fewer tokens. <span className="text-primary">Ceiling</span> pushes every buyback dollar through a constant-product pool with the live quote-side depth and assumes nobody sells into it — a fiction, since the other ~99% of flow is not modeled and the real pool is concentrated-liquidity (usually less slippage near the current price than constant-product). The true flywheel contribution sits between the two; the crowd decides the rest. This is a mechanical model of one input, not a price forecast.
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "up" }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-lg font-semibold num ${accent === "up" ? "text-up" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted num">{sub}</div>}
    </div>
  );
}
