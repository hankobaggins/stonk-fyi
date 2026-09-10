"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import TokenIcon from "./TokenIcon";
import { fmtNum, fmtUsd, timeAgo } from "@/lib/format";

// One sortable table for both kinds of tracked mint. Rows are plain data (no functions) so the
// server page can hand them across the boundary. Holder counts for the two kinds come from
// different providers (GMGN vs StonkFun's rewards ledger); the Kind column and filter keep that
// visible, the caveat under the table says it in words.

export type HolderChange = { abs: number; pct: number | null; hours: number; from: string; to: string } | null;

export type HolderRow = {
  mint: string;
  kind: "quote" | "coin";
  symbol: string;
  name: string;
  logoUrl?: string;
  provider: string; // issuer: xStocks / Backpack / Pre-stocks / Tessera
  quoteSymbol?: string; // coins: the asset they trade in
  marketCapUsd: number | null; // coins only
  holders: number | null;
  d1: HolderChange;
  d7: HolderChange;
  at: string | null; // quote: newest reading; coin: created
  href: string;
  external: boolean;
};

type SortKey = "symbol" | "provider" | "holders" | "d1" | "d7" | "marketCapUsd";
type Kind = "all" | "quote" | "coin";

const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

function ChangeCell({ c }: { c: HolderChange }) {
  if (!c) return <span className="text-muted text-xs">collecting</span>;
  const cls = c.abs > 0 ? "text-up" : c.abs < 0 ? "text-down" : "text-muted";
  return (
    <span className="num" title={`${signed(c.abs)} over ${c.hours.toFixed(1)}h · ${hhmm(c.from)} → ${hhmm(c.to)}`}>
      <span className={`${cls} text-[14px]`}>{signed(c.abs)}</span>
      {c.pct !== null && <span className="text-muted text-xs"> {c.pct > 0 ? "+" : ""}{c.pct.toFixed(1)}%</span>}
    </span>
  );
}

// Sort value per column; null sorts last in either direction.
function sortValue(r: HolderRow, k: SortKey): number | string | null {
  switch (k) {
    case "symbol": return r.symbol.toLowerCase();
    case "provider": return r.provider;
    case "holders": return r.holders;
    case "d1": return r.d1?.abs ?? null;
    case "d7": return r.d7?.abs ?? null;
    case "marketCapUsd": return r.marketCapUsd;
  }
}

const KINDS: { v: Kind; label: string }[] = [
  { v: "all", label: "All" },
  { v: "quote", label: "Quote assets" },
  { v: "coin", label: "Coins" },
];

function Th({ k, sort, onSort, right = false, children }: { k: SortKey; sort: { key: SortKey; desc: boolean }; onSort: (k: SortKey) => void; right?: boolean; children: ReactNode }) {
  const active = sort.key === k;
  return (
    <th className={right ? "r" : ""} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className={`uppercase tracking-[0.06em] hover:text-primary ${active ? "text-primary" : ""}`}>
        {children}
        <span className="inline-block w-3 text-[9px]">{active ? (sort.desc ? " ▼" : " ▲") : ""}</span>
      </button>
    </th>
  );
}

export default function HoldersTable({ rows, now }: { rows: HolderRow[]; now: number }) {
  const [kind, setKind] = useState<Kind>("all");
  const [issuer, setIssuer] = useState<string>("all");
  // Issuer chips come from the rows themselves, in first-seen order (xStocks, Backpack, Pre-stocks, Tessera).
  const issuers = [...new Set(rows.map((r) => r.provider))];
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "holders", desc: true });

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "symbol" && key !== "provider" }));

  const shown = rows
    .filter((r) => (kind === "all" || r.kind === kind) && (issuer === "all" || r.provider === issuer))
    .sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const c = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
      return sort.desc ? -c : c;
    });

  return (
    <>
      <div className="filterbar flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <button key={k.v} type="button" onClick={() => setKind(k.v)} aria-current={kind === k.v}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => setIssuer("all")} aria-current={issuer === "all"}>All issuers</button>
          {issuers.map((p) => (
            <button key={p} type="button" onClick={() => setIssuer(p)} aria-current={issuer === p}>
              {p}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted num ml-auto">{shown.length} rows · click a column to sort</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="r">#</th>
              <Th k="symbol" sort={sort} onSort={toggle}>Asset</Th>
              <th>Kind</th>
              <Th k="provider" sort={sort} onSort={toggle}>Issuer</Th>
              <Th k="holders" sort={sort} onSort={toggle} right>Holders</Th>
              <Th k="d1" sort={sort} onSort={toggle} right>24h</Th>
              <Th k="d7" sort={sort} onSort={toggle} right>7d</Th>
              <Th k="marketCapUsd" sort={sort} onSort={toggle} right>Market cap</Th>
              <th className="r">Read / age</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.mint}>
                <td className="r text-muted num">{String(i + 1).padStart(2, "0")}</td>
                <td>
                  {r.external ? (
                    <a href={r.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-accent">
                      <TokenIcon src={r.logoUrl} symbol={r.symbol} size={20} />
                      <span className="font-medium text-[14px]">{r.symbol}</span>
                      <span className="text-muted text-xs truncate max-w-[14rem]">{r.name}</span>
                    </a>
                  ) : (
                    <Link href={r.href} className="flex items-center gap-2 hover:text-accent">
                      <TokenIcon src={r.logoUrl} symbol={r.symbol} size={20} />
                      <span className="font-medium text-[14px]">{r.symbol}</span>
                      <span className="text-muted text-xs truncate max-w-[14rem]">{r.name}</span>
                    </Link>
                  )}
                </td>
                <td className="text-xs">
                  {r.kind === "quote" ? <span className="pill accent">quote asset</span> : <span className="pill">coin{r.quoteSymbol ? <span className="text-muted"> · {r.quoteSymbol}</span> : null}</span>}
                </td>
                <td className="text-secondary text-xs">{r.provider}</td>
                <td className="r num text-[14px]">{r.holders === null ? <span className="text-muted text-xs">no reading</span> : fmtNum(r.holders)}</td>
                <td className="r"><ChangeCell c={r.d1} /></td>
                <td className="r"><ChangeCell c={r.d7} /></td>
                <td className="r num text-[14px]">{r.marketCapUsd === null ? <span className="text-muted">—</span> : fmtUsd(r.marketCapUsd, { compact: true })}</td>
                <td className="r num text-muted text-xs">{r.at ? timeAgo(r.at, now) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
