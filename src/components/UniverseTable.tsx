"use client";

import { useState, type ReactNode } from "react";
import TokenIcon from "./TokenIcon";
import { TradeLink } from "./BuyButton";
import { fmtNum, timeAgo } from "@/lib/format";

// Every quote asset with at least one reward coin, in every category. Two holder figures per row from
// two providers, kept in separate columns: HolderScan's holder count (any balance, any venue) and this
// site's census of wallets holding a StonkFun coin that pays the asset. Rows are plain data.

export type UniverseChange = { abs: number; pct: number | null; hours: number; from: string; to: string; provider?: "holderscan" } | null;

export type UniverseRowView = {
  mint: string;
  symbol: string;
  name: string;
  category: string;
  categoryLabel: string;
  logoUrl?: string;
  coins: number;
  slots: number;
  holders: number | null;
  readAt: string | null;
  d1: UniverseChange;
  d7: UniverseChange;
  d30: UniverseChange;
  paid: number | null;
  paidD1: number | null;
  paidCoins: number | null;
  share: number | null;
};

type SortKey = "symbol" | "category" | "holders" | "d1" | "d7" | "d30" | "paid" | "paidD1" | "share" | "coins";

const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

const PRESETS: { label: string; cats: string[] }[] = [
  { label: "Stocks", cats: ["xstock", "backpack"] },
  { label: "Pre-IPO", cats: ["prestock", "tessera"] },
  { label: "Crypto", cats: ["custom", "solana", "leverage", "collectible"] },
];

function ChangeCell({ c, hint }: { c: UniverseChange; hint: string }) {
  if (!c) return <span className="text-muted text-xs" title={hint}>collecting</span>;
  const cls = c.abs > 0 ? "text-up" : c.abs < 0 ? "text-down" : "text-muted";
  const hs = c.provider === "holderscan";
  return (
    <span className="num" title={hs ? `HolderScan's own ${Math.round(c.hours / 24)}-day change, read ${c.to.slice(0, 10)}; stonk.fyi's readings take over once they cover the window` : `${signed(c.abs)} over ${c.hours.toFixed(0)}h · ${hhmm(c.from)} → ${hhmm(c.to)}`}>
      <span className={`${cls} text-[14px]`}>{signed(c.abs)}</span>
      {c.pct !== null && <span className="text-muted text-xs"> {c.pct > 0 ? "+" : ""}{c.pct.toFixed(1)}%</span>}
      {hs && <span className="text-muted text-[10px] align-super"> HS</span>}
    </span>
  );
}

function sortValue(r: UniverseRowView, k: SortKey): number | string | null {
  switch (k) {
    case "symbol": return r.symbol.toLowerCase();
    case "category": return r.categoryLabel;
    case "holders": return r.holders;
    case "d1": return r.d1?.abs ?? null;
    case "d7": return r.d7?.abs ?? null;
    case "d30": return r.d30?.abs ?? null;
    case "paid": return r.paid;
    case "paidD1": return r.paidD1;
    case "share": return r.share;
    case "coins": return r.coins;
  }
}

function Th({ k, sort, onSort, right = false, title, children }: { k: SortKey; sort: { key: SortKey; desc: boolean }; onSort: (k: SortKey) => void; right?: boolean; title?: string; children: ReactNode }) {
  const active = sort.key === k;
  return (
    <th className={right ? "r" : ""} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} title={title}>
      <button type="button" onClick={() => onSort(k)} className={`uppercase tracking-[0.06em] hover:text-primary ${active ? "text-primary" : ""}`}>
        {children}
        <span className="inline-block w-3 text-[9px]">{active ? (sort.desc ? " ▼" : " ▲") : ""}</span>
      </button>
    </th>
  );
}

export default function UniverseTable({ rows, categories, now }: { rows: UniverseRowView[]; categories: { key: string; label: string }[]; now: number }) {
  const all = categories.map((c) => c.key);
  const [selected, setSelected] = useState<string[]>(all);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "paid", desc: true });
  const toggleCat = (k: string) => setSelected((s) => (s.includes(k) ? (s.length === 1 ? s : s.filter((x) => x !== k)) : [...s, k]));
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "symbol" && key !== "category" }));
  const isAll = selected.length === all.length;
  const preset = (cats: string[]) => setSelected(cats.filter((c) => all.includes(c)));
  const same = (cats: string[]) => cats.filter((c) => all.includes(c)).length === selected.length && selected.every((c) => cats.includes(c));

  const shown = rows
    .filter((r) => selected.includes(r.category))
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
          <button type="button" onClick={() => setSelected(all)} aria-current={isAll}>All</button>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => preset(p.cats)} aria-current={!isAll && same(p.cats)}>{p.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {categories.map((c) => (
            <button key={c.key} type="button" onClick={() => toggleCat(c.key)} aria-current={selected.includes(c.key)} aria-pressed={selected.includes(c.key)}>
              {selected.includes(c.key) ? "☑" : "☐"} {c.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted num ml-auto">{shown.length} quote assets · click a column to sort</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="r">#</th>
              <Th k="symbol" sort={sort} onSort={toggle}>Quote asset</Th>
              <Th k="category" sort={sort} onSort={toggle}>Category</Th>
              <Th k="holders" sort={sort} onSort={toggle} right title="HolderScan holder count, read daily">Holders</Th>
              <Th k="d1" sort={sort} onSort={toggle} right>24h</Th>
              <Th k="d7" sort={sort} onSort={toggle} right>7d</Th>
              <Th k="d30" sort={sort} onSort={toggle} right>30d</Th>
              <Th k="paid" sort={sort} onSort={toggle} right title="Wallets holding a StonkFun reward coin that pays this asset (stonk.fyi census, daily, lower bound)">StonkFun wallets</Th>
              <Th k="paidD1" sort={sort} onSort={toggle} right>24h</Th>
              <Th k="share" sort={sort} onSort={toggle} right title="StonkFun wallets ÷ holders">Share</Th>
              <Th k="coins" sort={sort} onSort={toggle} right title="Reward coins launched against this asset">Coins</Th>
              <th className="r">Read</th>
              <th className="r">Trade</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.mint}>
                <td className="r text-muted num">{String(i + 1).padStart(2, "0")}</td>
                <td>
                  <a href={`https://holderscan.com/token/${r.mint}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-accent">
                    <TokenIcon src={r.logoUrl} symbol={r.symbol} size={20} />
                    <span className="font-medium text-[14px]">{r.symbol}</span>
                    <span className="text-muted text-xs truncate max-w-[12rem]">{r.name}</span>
                  </a>
                </td>
                <td className="text-secondary text-xs">{r.categoryLabel}</td>
                <td className="r num text-[14px]">{r.holders === null ? <span className="text-muted text-xs">no reading</span> : fmtNum(r.holders)}</td>
                <td className="r"><ChangeCell c={r.d1} hint="needs two daily readings" /></td>
                <td className="r"><ChangeCell c={r.d7} hint="needs about 6 days of readings" /></td>
                <td className="r"><ChangeCell c={r.d30} hint="needs about 24 days of readings" /></td>
                <td className="r num text-[14px]" title={r.paidCoins !== null ? `${r.paidCoins} of ${r.coins} coins covered by the census` : undefined}>
                  {r.paid === null ? <span className="text-muted text-xs">{r.coins ? "not covered" : "—"}</span> : <>{fmtNum(r.paid)}{r.paidCoins !== null && r.paidCoins < r.coins ? <span className="text-muted text-xs">+</span> : null}</>}
                </td>
                <td className="r num">{r.paidD1 === null ? <span className="text-muted text-xs">collecting</span> : <span className={`text-[14px] ${r.paidD1 > 0 ? "text-up" : r.paidD1 < 0 ? "text-down" : "text-muted"}`}>{signed(r.paidD1)}</span>}</td>
                <td className="r num text-[14px]">{r.share === null ? <span className="text-muted">—</span> : `${(r.share * 100).toFixed(r.share < 0.01 ? 2 : 1)}%`}</td>
                <td className="r num text-secondary text-xs">{fmtNum(r.coins)}</td>
                <td className="r num text-muted text-xs">{r.readAt ? timeAgo(r.readAt, now) : "—"}</td>
                <td className="r"><TradeLink mint={r.mint} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
