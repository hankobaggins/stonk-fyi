"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtPrice, fmtUsd } from "@/lib/format";

type Point = { ts: number; price: number | null; marketCap: number | null; volume24h: number | null };
type Metric = "price" | "marketCap" | "volume24h";

const METRICS: { key: Metric; label: string }[] = [
  { key: "price", label: "Price" },
  { key: "marketCap", label: "Market cap" },
  { key: "volume24h", label: "24h volume" },
];

// Price / market cap / rolling 24h volume from stonk.fyi's own snapshots, with a metric switcher.
export default function TokenHistoryChart({ points, height = 260 }: { points: Point[]; height?: number }) {
  const [metric, setMetric] = useState<Metric>("price");
  const fmt = metric === "price" ? (v: number) => fmtPrice(v) : (v: number) => fmtUsd(v);
  const data = points.filter((p) => p[metric] !== null);
  const spanMs = data.length ? data[data.length - 1].ts - data[0].ts : 0;
  const fmtTs = (t: number) =>
    spanMs > 2 * 86_400_000
      ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      : new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return (
    <div>
      <div className="flex gap-1 mb-2">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetric(m.key)}
            className={`text-xs px-2 py-1 rounded-md ${metric === m.key ? "bg-surface-2 text-primary" : "text-muted hover:text-primary"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="tokenFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-3)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--series-3)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={fmtTs} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} width={72} domain={["auto", "auto"]} />
          <Tooltip
            content={({ label, payload }) =>
              payload?.length ? (
                <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
                  <div className="text-muted">{new Date(Number(label)).toLocaleString("en-US", { timeZone: "UTC" })} UTC</div>
                  <div className="num">{fmt(payload[0].value as number)}</div>
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey={metric} stroke="var(--series-3)" strokeWidth={2} fill="url(#tokenFill)" dot={false} activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
