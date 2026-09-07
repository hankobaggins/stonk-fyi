"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtDay, fmtNum, fmtUsd } from "@/lib/format";

// Server components can't pass functions to client components, so formatting is chosen by name.
export type Fmt = "usd" | "count";
const F: Record<Fmt, (n: number) => string> = { usd: (n) => fmtUsd(n), count: (n) => fmtNum(n) };

const S = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];

type TooltipRow = { name?: string; value?: number; color?: string; dataKey?: string | number };

function TipBox({ label, rows, total }: { label?: string; rows: TooltipRow[]; total?: number }) {
  return (
    <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
      <div className="text-muted mb-1">{label}</div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-secondary">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: r.color }} />
            {r.name}
          </span>
          <span className="num text-primary">{fmtUsd(r.value)}</span>
        </div>
      ))}
      {total !== undefined && rows.length > 1 && (
        <div className="flex justify-between gap-4 border-t border-border mt-1 pt-1">
          <span className="text-muted">Total</span>
          <span className="num">{fmtUsd(total)}</span>
        </div>
      )}
    </div>
  );
}

// ---------- Daily revenue (stacked: holders + protocol) ----------

export function RevenueChart({ data, height = 260 }: { data: { date: string; holders: number; protocol: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickFormatter={(v) => fmtUsd(v)} tickLine={false} axisLine={false} width={56} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ label, payload }) =>
            payload?.length ? (
              <TipBox
                label={fmtDay(String(label))}
                rows={payload.map((p) => ({ name: p.name as string, value: p.value as number, color: p.color }))}
                total={payload.reduce((s, p) => s + ((p.value as number) ?? 0), 0)}
              />
            ) : null
          }
        />
        <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
        <Bar dataKey="holders" name="To holders" stackId="a" fill={S[1]} stroke="var(--surface-1)" strokeWidth={1} />
        <Bar dataKey="protocol" name="To protocol" stackId="a" fill={S[0]} stroke="var(--surface-1)" strokeWidth={1} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------- Cumulative area ----------

export function CumulativeChart({ data, height = 220, name = "Cumulative revenue" }: { data: { date: string; value: number }[]; height?: number; name?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={S[0]} stopOpacity={0.35} />
            <stop offset="100%" stopColor={S[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickFormatter={(v) => fmtUsd(v)} tickLine={false} axisLine={false} width={56} />
        <Tooltip
          content={({ label, payload }) =>
            payload?.length ? <TipBox label={fmtDay(String(label))} rows={[{ name, value: payload[0].value as number, color: S[0] }]} /> : null
          }
        />
        <Area type="monotone" dataKey="value" name={name} stroke={S[0]} strokeWidth={2} fill="url(#cumFill)" dot={false} activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------- Horizontal bars (one series, category identity) ----------

export function HBarChart({
  data,
  height,
  valueLabel = "Value",
  fmt = "usd",
}: {
  data: { name: string; value: number }[];
  height?: number;
  valueLabel?: string;
  fmt?: Fmt;
}) {
  const format = F[fmt];
  const h = height ?? Math.max(120, data.length * 28 + 16);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => format(v)} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)" }} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ label, payload }) =>
            payload?.length ? (
              <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
                <div className="text-muted">{label}</div>
                <div className="num">{valueLabel}: {format(payload[0].value as number)}</div>
              </div>
            ) : null
          }
        />
        <Bar dataKey="value" name={valueLabel} fill={S[0]} radius={[0, 4, 4, 0]} label={{ position: "right", formatter: (v: unknown) => format(Number(v)), fill: "var(--text-secondary)", fontSize: 11 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------- Category share: single-row stacked bar (identity via fixed slots) ----------

export function ShareBar({ data, fmt = "usd" }: { data: { name: string; value: number }[]; fmt?: Fmt }) {
  const format = F[fmt];
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2 gap-[2px]">
        {data.map((d, i) => (
          <div key={d.name} title={`${d.name}: ${format(d.value)}`} style={{ width: `${(d.value / total) * 100}%`, background: S[i % S.length] }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {data.map((d, i) => (
          <span key={d.name} className="flex items-center gap-1.5 text-secondary">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: S[i % S.length] }} />
            {d.name} <span className="text-muted num">{((d.value / total) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- Launches per day (single series) ----------

export function CountBarChart({ data, height = 200, name = "Launches", fmt = "count" }: { data: { date: string; value: number }[]; height?: number; name?: string; fmt?: Fmt }) {
  const format = F[fmt];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickFormatter={(v) => format(v)} tickLine={false} axisLine={false} width={fmt === "usd" ? 56 : 40} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ label, payload }) =>
            payload?.length ? (
              <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
                <div className="text-muted">{fmtDay(String(label))}</div>
                <div className="num">{name}: {format(payload[0].value as number)}</div>
              </div>
            ) : null
          }
        />
        <Bar dataKey="value" name={name} fill={S[2]} radius={[3, 3, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.date} fill={S[2]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------- Price history (line, single series) ----------

export function PriceChart({ data, height = 280 }: { data: { ts: number; price: number }[]; height?: number }) {
  const fmtTs = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const fmtP = (p: number) => (p >= 1 ? `$${p.toFixed(2)}` : p >= 0.01 ? `$${p.toFixed(3)}` : `$${p.toPrecision(2)}`);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={S[2]} stopOpacity={0.35} />
            <stop offset="100%" stopColor={S[2]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={fmtTs} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tickFormatter={fmtP} tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} />
        <Tooltip
          content={({ label, payload }) =>
            payload?.length ? (
              <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
                <div className="text-muted">{new Date(Number(label)).toLocaleString("en-US", { timeZone: "UTC" })} UTC</div>
                <div className="num">{fmtP(payload[0].value as number)}</div>
              </div>
            ) : null
          }
        />
        <Area type="monotone" dataKey="price" name="Price" stroke={S[2]} strokeWidth={2} fill="url(#priceFill)" dot={false} activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------- Burn events over time (bars, single series) ----------

export function BurnBarChart({ data, height = 220 }: { data: { date: string; value: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickFormatter={(v) => fmtNum(v)} tickLine={false} axisLine={false} width={56} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ label, payload }) =>
            payload?.length ? (
              <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
                <div className="text-muted">{String(label)}</div>
                <div className="num">{fmtNum(payload[0].value as number)} STONK burned</div>
              </div>
            ) : null
          }
        />
        <Bar dataKey="value" name="STONK burned" fill={S[1]} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
