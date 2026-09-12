import Link from "next/link";
import { getRewards, getTokens, type TokenQuery } from "@/lib/api";
import { getAprForTokens, YIELD_TRACKED } from "@/lib/yield";
import type { Token } from "@/lib/types";
import { fmtNum, nowMs } from "@/lib/format";
import { PageHeader, Section } from "@/components/ui";
import TokenTable, { DEFAULT_DIR, SORT_KEYS, sortTokens, type SortKey } from "@/components/TokenTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tokens & yield" };

const PAGE_SIZE = 50;
// StonkFun sorts only by these three, 100 a page. The page loads a pool of the first POOL tokens in that
// order (5 requests, 30s cache) and sorts/pages the pool here, so every numeric column header is sortable.
// Deeper than the pool needs a narrower filter or search.
const POOL = 500;
const API_PAGE = 100;
const SORTS = [
  { v: "marketCap", label: "Market cap" },
  { v: "volume", label: "24h volume" },
  { v: "newest", label: "Newest" },
] as const;
type Sort = (typeof SORTS)[number]["v"];
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
const POOL_LABEL: Record<Sort, string> = { marketCap: "largest by market cap", volume: "busiest by 24h volume", newest: "newest" };
const COL_LABEL: Record<SortKey, string> = { mcap: "market cap", price: "price", chg: "24h change", vol: "24h volume", ratio: "volume / market cap", apr1: "24h-based APR", apr3: "3d-based APR", holders: "holders", avg: "average per holder", age: "age" };

// StonkFun's reward-eligible holder count per reward coin (one /rewards call, 30s cache) for the Holders and
// Average-per-holder columns. Standard coins have no holder figure in the API.
async function getHolderCounts(): Promise<Record<string, number>> {
  try {
    const out: Record<string, number> = {};
    for (const l of (await getRewards()).data.launches) if (l.holderCount > 0) out[l.mint] = l.holderCount;
    return out;
  } catch {
    return {};
  }
}

const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function str(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TokensPage({ searchParams }: PageProps<"/tokens">) {
  const sp = await searchParams;
  const sortParam = str(sp.sort);
  const sort: Sort = SORTS.some((s) => s.v === sortParam) ? (sortParam as Sort) : "marketCap";
  const byParam = str(sp.by);
  const by: SortKey | null = SORT_KEYS.some((k) => k === byParam) ? (byParam as SortKey) : null;
  const dir: "asc" | "desc" = str(sp.dir) === "asc" ? "asc" : str(sp.dir) === "desc" ? "desc" : by ? DEFAULT_DIR[by] : "desc";
  const q: TokenQuery = {
    q: str(sp.q) || undefined,
    sort,
    status: str(sp.status) || undefined,
    mode: str(sp.mode) || undefined,
    category: str(sp.category) || undefined,
    quoteMint: str(sp.quoteMint) || undefined,
    page: Math.max(1, Number(str(sp.page) ?? 1) || 1),
  };
  const now = nowMs();

  // The pool: first page tells us the total; the rest of the pool only if there is more.
  const first = await getTokens({ ...q, page: 1, pageSize: API_PAGE });
  const total = first.data.pagination.total;
  const morePages = Math.min(Math.ceil(Math.min(total, POOL) / API_PAGE), POOL / API_PAGE) - 1;
  const rest = morePages > 0 ? await Promise.all(Array.from({ length: morePages }, (_, i) => getTokens({ ...q, page: i + 2, pageSize: API_PAGE }))) : [];
  const seen = new Set<string>();
  const pool: Token[] = [];
  for (const r of [first, ...rest]) {
    for (const t of r.data.tokens) {
      if (seen.has(t.mint)) continue;
      seen.add(t.mint);
      pool.push(t);
    }
  }

  const [apr, holders] = await Promise.all([getAprForTokens(pool), getHolderCounts()]);
  const sorted = by ? sortTokens(pool, apr.byMint, by, dir, holders) : pool;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(q.page!, totalPages);
  const tokens = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const with3d = tokens.filter((t) => apr.byMint[t.mint]?.d3).length;
  const rewardOnPage = tokens.filter((t) => t.mode === "reward").length;
  const truncated = total > pool.length;

  const href = (patch: Partial<Record<string, string | number | undefined>>) => {
    const p = new URLSearchParams();
    const merged = { ...q, by: by ?? undefined, dir: by ? dir : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === "" || k === "pageSize") continue;
      if (k === "page" && Number(v) <= 1) continue;
      if (k === "sort" && v === "marketCap") continue;
      if (k === "dir" && merged.by && v === DEFAULT_DIR[merged.by as SortKey]) continue;
      p.set(k, String(v));
    }
    const s = p.toString();
    return `/tokens${s ? `?${s}` : ""}`;
  };
  const tableSort = { key: by ?? (sort === "volume" ? "vol" : sort === "newest" ? "age" : "mcap"), dir: by ? dir : sort === "newest" ? ("asc" as const) : ("desc" as const), href: (key: SortKey, d: "asc" | "desc") => href({ by: key, dir: d, page: 1 }) };

  const subtitle = [
    `${fmtNum(total)} tokens match`,
    truncated ? `showing the ${fmtNum(pool.length)} ${POOL_LABEL[sort]}` : null,
    by ? `sorted by ${COL_LABEL[by]} ${dir === "desc" ? "▼" : "▲"}` : null,
    `page ${page} of ${totalPages}`,
    `APR for the ${YIELD_TRACKED} largest reward coins`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <PageHeader title="Tokens & yield" sub={subtitle}>
        <div className="flex flex-col items-end gap-2">
          <form action="/tokens" className="flex gap-2">
            {sort !== "marketCap" && <input type="hidden" name="sort" value={sort} />}
            <input
              name="q"
              defaultValue={q.q ?? ""}
              placeholder="Search name, symbol or mint"
              className="bg-surface-1 border border-border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-border-strong"
            />
          </form>
          <div className="text-right text-xs text-secondary num space-y-0.5">
            <div><span className="pill up">realized holder-fee APR</span></div>
            <div>Market snapshot: {dmy(apr.generatedAt)} · {hhmm(apr.generatedAt)}</div>
          </div>
        </div>
      </PageHeader>

      <div className="filterbar flex flex-wrap gap-2">
        <div className="flex gap-1">
          {SORTS.map((s) => (
            <Link key={s.v} href={href({ sort: s.v, page: 1 })} aria-current={sort === s.v}>
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

      <Section
        title={by ? `Tokens by ${COL_LABEL[by]}` : sort === "volume" ? "Tokens by 24h volume" : sort === "newest" ? "Newest tokens" : "Tokens by market cap"}
        action={<span className="num text-xs text-muted">click a column to sort · StonkFun market data · 30s · stonk.fyi payout snapshots · 5 min · Jupiter prices · 5 min</span>}
      >
        {tokens.length ? (
          <TokenTable tokens={tokens} startRank={(page - 1) * PAGE_SIZE + 1} now={now} apr={apr.byMint} sort={tableSort} holders={holders} />
        ) : (
          <div className="p-8 text-center text-muted text-sm">No tokens match.</div>
        )}

        <div className="mt-4 pt-4 border-t border-border text-sm space-y-1.5 leading-relaxed">
          <p className="font-medium">APR is annualized from payouts holders actually received. It is a yield estimate, not a promised return.</p>
          {apr.status === "no-db" && <p className="text-secondary text-[13px]">The APR columns need the site&apos;s payout snapshots (Postgres), which this deployment does not have.</p>}
          {apr.status === "db-error" && (
            <p className="text-secondary text-[13px]">The payout readings could not be read just now (the snapshot store did not answer). The worker keeps recording; try again in a minute, or check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → reward_windows.</p>
          )}
          {truncated && <p className="text-secondary text-[13px]">Sorting covers the {fmtNum(pool.length)} {POOL_LABEL[sort]} that match the filters, not all {fmtNum(total)}; narrow the filters or search to reach the rest.</p>}
          <p className="text-secondary text-[13px]">Only reward-mode coins pay holders, and only the {YIELD_TRACKED} largest by market cap are snapshotted, so the columns read &ldquo;—&rdquo; for standard coins and &ldquo;not tracked&rdquo; for smaller reward coins. Payout tokens over each window are from this site&apos;s own 5-minute readings of StonkFun&apos;s reward ledger, valued at the quote asset&apos;s Jupiter price now (STONK at StonkFun&apos;s price), divided by the coin&apos;s market cap now. No compounding, no price change of the coin or its quote asset.</p>
          <p className="text-secondary text-[13px]">Holders is StonkFun&apos;s count of reward-eligible wallets for reward coins (standard coins carry none), live. Average per holder divides the coin&apos;s market cap by it: the stake each wallet would hold if every holder held the same. A few large wallets pull it up, so a high figure on a coin with few holders is concentration, not a broad base — $STONK&apos;s own median position is on the home page.</p>
          <p className="text-secondary text-[13px]">Market cap is the denominator because it is the one figure both you and this site can check. Payouts go only to eligible wallets (pools and program accounts are excluded), so a holder&apos;s own yield on eligible balance is higher than the figure shown. The 3d column averages daily payouts over 72 hours; the 24h column moves with the last day alone.</p>
          <div className="flex flex-wrap justify-between gap-2 pt-1 text-xs text-muted num">
            <span>Sources: StonkFun tokens &amp; rewards · stonk.fyi snapshots · Jupiter</span>
            {rewardOnPage > 0 && <span className="text-up">{with3d} / {rewardOnPage} reward coins on this page have the full 72-hour window</span>}
          </div>
        </div>
      </Section>

      <div className="filterbar flex items-center justify-between text-sm">
        <Link href={href({ page: page - 1 })} aria-disabled={page <= 1} className={page <= 1 ? "opacity-40 pointer-events-none" : ""}>
          ← Prev
        </Link>
        <span className="text-muted num">
          {page} / {totalPages}
        </span>
        <Link href={href({ page: page + 1 })} className={page >= totalPages ? "opacity-40 pointer-events-none" : ""}>
          Next →
        </Link>
      </div>

      <p className="text-xs text-muted">
        Lifetime payouts per coin, and where the quote-asset prices come from, are on the <Link href="/rewards" className="underline underline-offset-2 hover:text-primary">Rewards page</Link>. How the APR is built is on <Link href="/about#yield" className="underline underline-offset-2 hover:text-primary">the About page</Link>. Not financial advice.
      </p>
    </div>
  );
}
