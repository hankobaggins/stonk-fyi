import Link from "next/link";
import type { ReactNode } from "react";
import { fmtPct } from "@/lib/format";

export function KpiTile({ label, value, sub, delta }: { label: string; value: ReactNode; sub?: ReactNode; delta?: number | null }) {
  return (
    <div className="card p-4 min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold num truncate">{value}</div>
      {(sub !== undefined || delta !== undefined) && (
        <div className="mt-1 text-xs text-secondary flex items-center gap-2 num">
          {delta !== undefined && delta !== null && <Delta value={delta} />}
          {sub}
        </div>
      )}
    </div>
  );
}

export function Delta({ value, digits = 1 }: { value?: number | null; digits?: number }) {
  if (value === undefined || value === null) return <span className="text-muted">—</span>;
  const cls = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted";
  return (
    <span className={`${cls} num`}>
      {value > 0 ? "▲" : value < 0 ? "▼" : ""} {fmtPct(Math.abs(value), digits).replace("+", "")}
    </span>
  );
}

export function Section({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="flex items-center justify-between gap-4 mb-3">
        <h2 className="text-sm font-medium text-secondary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function ModePill({ mode, bps }: { mode?: string; bps?: number }) {
  if (mode === "reward") return <span className="pill accent">reward {bps ? `${bps / 100}%` : ""}</span>;
  if (mode === "standard") return <span className="pill">standard</span>;
  return <span className="pill">{mode ?? "—"}</span>;
}

export function StatusPill({ status, progress }: { status: string; progress?: number }) {
  if (status === "graduated") return <span className="pill up">graduated</span>;
  const pct = progress !== undefined ? Math.round(progress * 100) : null;
  return <span className="pill">{status}{pct !== null ? ` · ${pct}%` : ""}</span>;
}

export function ExplorerLink({ addr, kind = "address", label }: { addr: string; kind?: "address" | "tx" | "token"; label?: ReactNode }) {
  const href = `https://solscan.io/${kind}/${addr}`;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-mono text-xs text-secondary hover:text-accent underline-offset-2 hover:underline">
      {label ?? addr}
    </a>
  );
}

export function TokenLink({ mint, children }: { mint: string; children: ReactNode }) {
  return (
    <Link href={`/tokens/${mint}`} className="hover:text-accent">
      {children}
    </Link>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-muted py-8 text-center">{children}</div>;
}
