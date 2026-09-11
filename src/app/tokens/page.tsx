import Link from "next/link";
import { getTokens, type TokenQuery } from "@/lib/api";
import { getAprForTokens, getYieldRanking, YIELD_MIN_AGE_HOURS, YIELD_TRACKED, type AprLookup } from "@/lib/yield";
import type { Token } from "@/lib/types";
import { fmtNum, nowMs } from "@/lib/format";
import { PageHeader, Section } from "@/components/ui";
import TokenTable from "@/components/TokenTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tokens & yield" };

const PAGE_SIZE = 50;
const SORTS = [
  { v: "marketCap", label: "Market cap" },
  { v: "volume", label: "24h volume" },
  { v: "newest", label: "Newest" },
  { v: "yield", label: "Yield" },
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
const TITLES: Record<Sort, string> = { marketCap: "Tokens by market cap", volume: "Tokens by 24h volume", newest: "Newest tokens", yield: "Largest yield-paying coins" };

const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function str(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

// The Yield sort is ranked here, not by StonkFun, so search and filters are applied here too.
function matches(t: Token, q: TokenQuery) {
  if (q.q) {
    const s = q.q.toLowerCase();
    if (!(t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.mint === q.q)) return false;
  }
  if (q.status && t.status !== q.status) return false;
  if (q.category && t.quote.category !== q.category) return false;
  if (q.quoteMint && t.quote.mint !== q.quoteMint) return false;
  return true;
}

export default async function TokensPage({ searchParams }: PageProps<"/tokens">) {
  const sp = await searchParams;
  const sortParam = str(sp.sort);
  const sort: Sort = SORTS.some((s) => s.v === sortParam) ? (sortParam as Sort) : "marketCap";
  const q: TokenQuery = {
    q: str(sp.q) || undefined,
    sort: sort === "yield" ? "marketCap" : sort,
    status: str(sp.status) || undefined,
    mode: sort === "yield" ? "reward" : str(sp.mode) || undefined,
    category: str(sp.category) || undefined,
    quoteMint: str(sp.quoteMint) || undefined,
    page: Math.max(1, Number(str(sp.page) ?? 1) || 1),
    pageSize: PAGE_SIZE,
  };
  const now = nowMs();

  let tokens: Token[];
  let total: number;
  let apr: AprLookup;
  let yieldNote: string | null = null;
  if (sort === "yield") {
    const r = await getYieldRanking();
    const all = r.tokens.filter((t) => matches(t, q));
    total = all.length;
    tokens = all.slice((q.page! - 1) * PAGE_SIZE, q.page! * PAGE_SIZE);
    apr = r.apr;
    if (r.status === "collecting")
      yieldNote = `Collecting payout readings: ${r.historyHours < 1 ? "under an hour" : `${r.historyHours.toFixed(1)} hours`} so far. The 24h column appears after about 20 hours of readings, the 3-day column after about 58.${r.candidates ? ` ${fmtNum(r.candidates)} reward coins qualify by age and are being tracked.` : ""}`;
  } else {
    const res = await getTokens(q);
    tokens = res.data.tokens;
    total = res.data.pagination.total;
    apr = await getAprForTokens(tokens);
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(q.page!, totalPages);
  const with3d = tokens.filter((t) => apr.byMint[t.mint]?.d3).length;
  const rewardOnPage = tokens.filter((t) => t.mode === "reward").length;

  const href = (patch: Partial<Record<string, string | number | undefined>>) => {
    const p = new URLSearchParams();
    const merged = { ...q, sort, mode: sort === "yield" ? str(sp.mode) || undefined : q.mode, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === "" || k === "pageSize") continue;
      if (k === "page" && Number(v) <= 1) continue;
      if (k === "sort" && v === "marketCap") continue;
      p.set(k, String(v));
    }
    const s = p.toString();
    return `/tokens${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tokens & yield"
        sub={
          sort === "yield"
            ? `Tracked reward coins with at least ${YIELD_MIN_AGE_HOURS} hours of trading history that paid holders inside the last 3 days, ranked by realized APR · ${fmtNum(total)} coins · page ${page} of ${totalPages}`
            : `${fmtNum(total)} tokens match · page ${page} of ${totalPages} · APR for the ${YIELD_TRACKED} largest reward coins`
        }
      >
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
        {sort !== "yield" && (
          <>
            <span className="w-px bg-border mx-1" />
            <div className="flex gap-1">
              {MODES.map((s) => (
                <Link key={s.v} href={href({ mode: s.v || undefined, page: 1 })} aria-current={(q.mode ?? "") === s.v}>
                  {s.label}
                </Link>
              ))}
            </div>
          </>
        )}
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

      <Section title={TITLES[sort]} action={<span className="num text-xs text-muted">StonkFun market data · 30s · stonk.fyi payout snapshots · 5 min · Jupiter prices · 5 min</span>}>
        {tokens.length ? (
          <TokenTable tokens={tokens} startRank={(page - 1) * PAGE_SIZE + 1} now={now} apr={apr.byMint} />
        ) : (
          <div className="p-8 text-center text-muted text-sm">{yieldNote ?? (sort === "yield" ? "No tracked coin matches." : "No tokens match.")}</div>
        )}

        <div className="mt-4 pt-4 border-t border-border text-sm space-y-1.5 leading-relaxed">
          <p className="font-medium">APR is annualized from payouts holders actually received. It is a yield estimate, not a promised return.</p>
          {apr.status === "no-db" && <p className="text-secondary text-[13px]">The APR columns need the site&apos;s payout snapshots (Postgres), which this deployment does not have.</p>}
          {apr.status === "db-error" && (
            <p className="text-secondary text-[13px]">The payout readings could not be read just now (the snapshot store did not answer). The worker keeps recording; try again in a minute, or check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → reward_windows.</p>
          )}
          {yieldNote && tokens.length > 0 && <p className="text-secondary text-[13px]">{yieldNote}</p>}
          <p className="text-secondary text-[13px]">Only reward-mode coins pay holders, and only the {YIELD_TRACKED} largest by market cap are snapshotted, so the columns read &ldquo;—&rdquo; for standard coins and &ldquo;not tracked&rdquo; for smaller reward coins. Payout tokens over each window are from this site&apos;s own 5-minute readings of StonkFun&apos;s reward ledger, valued at the quote asset&apos;s Jupiter price now (STONK at StonkFun&apos;s price), divided by the coin&apos;s market cap now. No compounding, no price change of the coin or its quote asset.</p>
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
