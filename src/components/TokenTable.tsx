import Link from "next/link";
import type { ReactNode } from "react";
import type { Token } from "@/lib/types";
import type { AprCell, TokenApr } from "@/lib/yield";
import { fmtNum, fmtPrice, fmtUsd, timeAgo } from "@/lib/format";
import { resolveImage } from "@/lib/api";
import { Delta, StatusPill, TokenLink } from "./ui";
import TokenIcon from "./TokenIcon";
import { TradeLink } from "./BuyButton";

const fmtApr = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";

const WHY: Record<NonNullable<TokenApr["why"]>, string> = {
  standard: "—",
  untracked: "not tracked",
  collecting: "collecting",
  unpriced: "unpriced",
  "no-db": "—",
  "db-error": "—",
};

// One realized-APR cell: a bar scaled to the largest APR on the page plus the figure. Empty cells say why.
export function AprCol({ c, max, cls, why }: { c: AprCell; max: number; cls: string; why: TokenApr["why"] }) {
  if (!c) return <span className="text-muted text-xs">{why ? WHY[why] : "—"}</span>;
  const w = max > 0 ? Math.max(2, (c.apr / max) * 100) : 0;
  return (
    <span className="flex items-center gap-3 justify-end" title={`${fmtUsd(c.usd)} paid over ${c.hours.toFixed(1)}h · ${hhmm(c.from)} → ${hhmm(c.to)}`}>
      <span className="aprbar w-20 sm:w-28 shrink-0"><i className={cls} style={{ width: `${w}%` }} /></span>
      <span className={`num text-[14px] font-medium w-16 text-right ${cls}`}>{fmtApr(c.apr)}</span>
    </span>
  );
}

// Column sorts. Every numeric column is sortable; the page sorts its loaded pool and paginates, so a header
// click is a link (`?by=<key>&dir=asc|desc`) and the table stays a server component. Nulls sort last either way.
export const SORT_KEYS = ["mcap", "price", "chg", "vol", "ratio", "apr1", "apr3", "holders", "avg", "age"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type TableSort = { key: SortKey; dir: "asc" | "desc"; href: (key: SortKey, dir: "asc" | "desc") => string };
export const DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = { mcap: "desc", price: "desc", chg: "desc", vol: "desc", ratio: "desc", apr1: "desc", apr3: "desc", holders: "desc", avg: "desc", age: "asc" };

// `holders` = StonkFun's reward-eligible holderCount per reward coin (from /rewards); standard coins have none.
// Average per holder = market cap ÷ that count: what the typical wallet's stake would be if every holder held the
// same — a few large wallets pull it up, so a high figure with few holders is concentration, not conviction.
export function avgPerHolder(t: Token, holders: Record<string, number> | undefined): number | null {
  const h = holders?.[t.mint];
  const mc = t.market?.marketCapUsd;
  return h && h > 0 && mc && mc > 0 ? mc / h : null;
}

export function sortValue(t: Token, apr: Record<string, TokenApr> | undefined, k: SortKey, holders?: Record<string, number>): number | null {
  const m = t.market ?? {};
  const n = (v: number | undefined | null) => (v === undefined || v === null || Number.isNaN(v) ? null : v);
  switch (k) {
    case "holders": return n(holders?.[t.mint]);
    case "avg": return avgPerHolder(t, holders);
    case "mcap": return n(m.marketCapUsd);
    case "price": return n(m.priceUsd);
    case "chg": return n(m.priceChange24h);
    case "vol": return n(m.volume24hUsd);
    case "ratio": return m.marketCapUsd && m.volume24hUsd ? m.volume24hUsd / m.marketCapUsd : null;
    case "apr1": return apr?.[t.mint]?.d1?.apr ?? null;
    case "apr3": return apr?.[t.mint]?.d3?.apr ?? null;
    case "age": return -Date.parse(t.createdAt); // asc = newest first
  }
}

export function sortTokens(tokens: Token[], apr: Record<string, TokenApr> | undefined, key: SortKey, dir: "asc" | "desc", holders?: Record<string, number>): Token[] {
  const vals = new Map(tokens.map((t) => [t.mint, sortValue(t, apr, key, holders)]));
  return [...tokens].sort((a, b) => {
    const va = vals.get(a.mint) ?? null;
    const vb = vals.get(b.mint) ?? null;
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return dir === "desc" ? vb - va : va - vb;
  });
}

function Th({ k, sort, right = false, children, sub }: { k: SortKey; sort?: TableSort; right?: boolean; children: ReactNode; sub?: ReactNode }) {
  if (!sort) return <th className={right ? "r" : ""}>{children}{sub}</th>;
  const active = sort.key === k;
  const next = active ? (sort.dir === "desc" ? "asc" : "desc") : DEFAULT_DIR[k];
  return (
    <th className={right ? "r" : ""} aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
      <Link href={sort.href(k, next)} className={`hover:text-primary ${active ? "text-primary" : ""}`}>
        {children}
        <span className="inline-block w-3 text-[9px]">{active ? (sort.dir === "desc" ? " ▼" : " ▲") : ""}</span>
      </Link>
      {sub}
    </th>
  );
}

// `apr` (per mint, from getAprForTokens) adds the two realized holder-fee APR columns in the /yield style.
// The full table puts the JTX buy link where the Mode pill used to be (owner's call 2026-09-11; the APR column
// already tells standard from reward); the compact table keeps it as a trailing Trade column.
export default function TokenTable({ tokens, startRank = 1, now, compact = false, apr, sort, holders }: { tokens: Token[]; startRank?: number; now: number; compact?: boolean; apr?: Record<string, TokenApr>; sort?: TableSort; holders?: Record<string, number> }) {
  const max1 = apr ? Math.max(0, ...tokens.map((t) => apr[t.mint]?.d1?.apr ?? 0)) : 0;
  const max3 = apr ? Math.max(0, ...tokens.map((t) => apr[t.mint]?.d3?.apr ?? 0)) : 0;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th className="r">#</th>
            <th>Token</th>
            <th>Pair</th>
            <Th k="price" sort={sort} right>Price</Th>
            <Th k="chg" sort={sort} right>24h</Th>
            <Th k="mcap" sort={sort} right>Market cap</Th>
            <Th k="vol" sort={sort} right>24h volume</Th>
            {apr && (
              <>
                <Th k="apr1" sort={sort} right sub={<><br /><span className="normal-case tracking-normal text-[10px]">from the last 24h of payouts</span></>}>24h-based APR</Th>
                <Th k="apr3" sort={sort} right sub={<><br /><span className="normal-case tracking-normal text-[10px]">average over the last 72h</span></>}>3d-based APR</Th>
              </>
            )}
            {!compact && holders && (
              <>
                <Th k="holders" sort={sort} right>Holders</Th>
                <Th k="avg" sort={sort} right sub={<><br /><span className="normal-case tracking-normal text-[10px]">market cap ÷ holders</span></>}>Avg per holder</Th>
              </>
            )}
            {!compact && (
              <>
                <Th k="ratio" sort={sort} right>Vol / MC</Th>
                <th>Buy</th>
                <th>Status</th>
                <Th k="age" sort={sort} right>Age</Th>
              </>
            )}
            {compact && <th className="r">Trade</th>}
          </tr>
        </thead>
        <tbody>
          {tokens.map((t, i) => {
            const m = t.market ?? {};
            const ratio = m.marketCapUsd && m.volume24hUsd ? m.volume24hUsd / m.marketCapUsd : undefined;
            const img = resolveImage(t.imageUrl);
            const a = apr?.[t.mint];
            return (
              <tr key={t.mint}>
                <td className="r text-muted num">{String(startRank + i).padStart(2, "0")}</td>
                <td>
                  <TokenLink mint={t.mint}>
                    <span className="flex items-center gap-2.5">
                      <TokenIcon src={img} symbol={t.symbol} size={24} />
                      <span className="flex flex-col leading-tight">
                        <span className="font-medium text-[14px]">{t.symbol}</span>
                        <span className="text-[11px] text-muted max-w-[160px] truncate">{t.name}</span>
                      </span>
                    </span>
                  </TokenLink>
                </td>
                <td>
                  <span className="flex flex-col leading-tight">
                    <span className="font-medium">{t.quote.symbol}</span>
                    {(t.quote.categoryLabel ?? t.quote.category) && (t.quote.categoryLabel ?? t.quote.category) !== "Custom" && <span className="text-[11px] text-muted">{t.quote.categoryLabel ?? t.quote.category}</span>}
                  </span>
                </td>
                <td className="r num">{fmtPrice(m.priceUsd)}</td>
                <td className="r"><Delta value={m.priceChange24h} /></td>
                <td className="r num text-[14px]">{fmtUsd(m.marketCapUsd, { compact: true })}</td>
                <td className="r num">{fmtUsd(m.volume24hUsd, { compact: true })}</td>
                {apr && (
                  <>
                    <td className="r"><AprCol c={a?.d1 ?? null} max={max1} cls="apr1" why={a?.why ?? null} /></td>
                    <td className="r"><AprCol c={a?.d3 ?? null} max={max3} cls="apr3" why={a?.why ?? null} /></td>
                  </>
                )}
                {!compact && holders && (
                  <>
                    <td className="r num">{holders[t.mint] ? fmtNum(holders[t.mint]) : <span className="text-muted text-xs">{t.mode === "reward" ? "—" : "standard"}</span>}</td>
                    <td className="r num">{avgPerHolder(t, holders) !== null ? fmtUsd(avgPerHolder(t, holders)) : <span className="text-muted text-xs">—</span>}</td>
                  </>
                )}
                {!compact && (
                  <>
                    <td className="r num text-secondary">{ratio !== undefined ? `${ratio.toFixed(2)}×` : "—"}</td>
                    <td><TradeLink mint={t.mint} /></td>
                    <td><StatusPill status={t.status} progress={t.graduationProgress} /></td>
                    <td className="r text-muted num">{timeAgo(t.createdAt, now)}</td>
                  </>
                )}
                {compact && <td className="r"><TradeLink mint={t.mint} /></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
