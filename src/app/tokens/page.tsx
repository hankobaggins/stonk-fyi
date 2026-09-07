import Link from "next/link";
import { getTokens, type TokenQuery } from "@/lib/api";
import { fmtNum, nowMs } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import TokenTable from "@/components/TokenTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tokens" };

const SORTS = [
  { v: "marketCap", label: "Market cap" },
  { v: "volume", label: "24h volume" },
  { v: "newest", label: "Newest" },
] as const;
const STATUSES = [
  { v: "", label: "All" },
  { v: "graduated", label: "Graduated" },
  { v: "bonding", label: "Bonding" },
];
const MODES = [
  { v: "", label: "Any mode" },
  { v: "standard", label: "Standard" },
  { v: "reward", label: "Reward" },
];
const CATEGORIES = [
  { v: "", label: "Any pair" },
  { v: "xstock", label: "xStocks" },
  { v: "prestock", label: "PreStocks" },
  { v: "tessera", label: "Tessera" },
  { v: "backpack", label: "Sunrise" },
  { v: "currency", label: "Currencies" },
  { v: "solana", label: "SOL" },
  { v: "custom", label: "Custom" },
];

function str(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TokensPage({ searchParams }: PageProps<"/tokens">) {
  const sp = await searchParams;
  const q: TokenQuery = {
    q: str(sp.q) || undefined,
    sort: (str(sp.sort) as TokenQuery["sort"]) || "marketCap",
    status: str(sp.status) || undefined,
    mode: str(sp.mode) || undefined,
    category: str(sp.category) || undefined,
    quoteMint: str(sp.quoteMint) || undefined,
    page: Math.max(1, Number(str(sp.page) ?? 1) || 1),
    pageSize: 50,
  };
  const res = await getTokens(q);
  const { tokens, pagination } = res.data;
  const now = nowMs();

  const href = (patch: Partial<Record<string, string | number | undefined>>) => {
    const p = new URLSearchParams();
    const merged = { ...q, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === "" || k === "pageSize") continue;
      if (k === "page" && Number(v) <= 1) continue;
      p.set(k, String(v));
    }
    const s = p.toString();
    return `/tokens${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader title="Tokens" sub={`${fmtNum(pagination.total)} tokens match · page ${pagination.page} of ${pagination.totalPages}`}>
        <form action="/tokens" className="flex gap-2">
          {q.sort && <input type="hidden" name="sort" value={q.sort} />}
          <input
            name="q"
            defaultValue={q.q ?? ""}
            placeholder="Search name, symbol or mint"
            className="bg-surface-1 border border-border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-border-strong"
          />
        </form>
      </PageHeader>

      <div className="filterbar flex flex-wrap gap-2 mb-4">
        <div className="flex gap-1">
          {SORTS.map((s) => (
            <Link key={s.v} href={href({ sort: s.v, page: 1 })} aria-current={q.sort === s.v}>
              {s.label}
            </Link>
          ))}
        </div>
        <span className="w-px bg-border mx-1" />
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <Link key={s.v} href={href({ status: s.v || undefined, page: 1 })} aria-current={(q.status ?? "") === s.v}>
              {s.label}
            </Link>
          ))}
        </div>
        <span className="w-px bg-border mx-1" />
        <div className="flex gap-1">
          {MODES.map((s) => (
            <Link key={s.v} href={href({ mode: s.v || undefined, page: 1 })} aria-current={(q.mode ?? "") === s.v}>
              {s.label}
            </Link>
          ))}
        </div>
        <span className="w-px bg-border mx-1" />
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map((s) => (
            <Link key={s.v} href={href({ category: s.v || undefined, quoteMint: undefined, page: 1 })} aria-current={(q.category ?? "") === s.v && !q.quoteMint}>
              {s.label}
            </Link>
          ))}
        </div>
        {q.quoteMint && (
          <Link href={href({ quoteMint: undefined, page: 1 })} aria-current className="ml-1">
            pair: {tokens[0]?.quote.symbol ?? q.quoteMint.slice(0, 6)} ✕
          </Link>
        )}
      </div>

      <div className="card">
        {tokens.length ? <TokenTable tokens={tokens} startRank={(pagination.page - 1) * pagination.pageSize + 1} now={now} /> : <div className="p-8 text-center text-muted text-sm">No tokens match.</div>}
      </div>

      <div className="filterbar flex items-center justify-between mt-4 text-sm">
        <Link href={href({ page: pagination.page - 1 })} aria-disabled={pagination.page <= 1} className={pagination.page <= 1 ? "opacity-40 pointer-events-none" : ""}>
          ← Prev
        </Link>
        <span className="text-muted num">
          {pagination.page} / {pagination.totalPages}
        </span>
        <Link href={href({ page: pagination.page + 1 })} className={pagination.page >= pagination.totalPages ? "opacity-40 pointer-events-none" : ""}>
          Next →
        </Link>
      </div>
    </div>
  );
}
