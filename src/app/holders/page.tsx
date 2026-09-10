import Link from "next/link";
import { CATEGORY_LABEL, getHoldersTable, HOLDERS_TRACKED } from "@/lib/holders";
import { nowMs, timeAgo } from "@/lib/format";
import { resolveImage } from "@/lib/api";
import HoldersTable, { type HolderRow } from "@/components/HoldersTable";
import { Empty, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Holders of stock-quoted assets" };

const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export default async function HoldersPage() {
  const now = nowMs();
  const t = await getHoldersTable();
  const reads = t.quotes.map((q) => q.readAt).filter(Boolean) as string[];
  const lastRead = reads.length ? reads.sort()[reads.length - 1] : null;
  const withReading = t.quotes.filter((q) => q.holders !== null).length;

  // One flat row list for the client table: plain data only (rule 3 in CLAUDE.md).
  const rows: HolderRow[] = [
    ...t.quotes.map<HolderRow>((q) => ({
      mint: q.mint,
      kind: "quote",
      symbol: q.symbol,
      name: q.name,
      logoUrl: resolveImage(q.logoUrl),
      provider: q.categoryLabel,
      marketCapUsd: null,
      holders: q.holders,
      d1: q.d1,
      d7: q.d7,
      at: q.readAt,
      href: `https://gmgn.ai/sol/token/${q.mint}`,
      external: true,
    })),
    ...t.coins.map<HolderRow>((c) => ({
      mint: c.mint,
      kind: "coin",
      symbol: c.symbol,
      name: c.name,
      provider: CATEGORY_LABEL[c.quoteCategory] ?? c.quoteCategory,
      quoteSymbol: c.quoteSymbol,
      marketCapUsd: c.marketCapUsd,
      holders: c.holders,
      d1: c.d1,
      d7: c.d7,
      at: c.createdAt,
      href: `/tokens/${c.mint}`,
      external: false,
    })),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Holders of stock-quoted assets"
        sub={`Wallets holding each tokenized-stock quote asset (xStocks, Backpack, pre-stocks, Tessera) and the ${HOLDERS_TRACKED} largest reward coins quoted in them, with 24h and 7d change.`}
      >
        <div className="text-right text-xs text-secondary num space-y-0.5">
          <div><span className="pill up">unique holders</span></div>
          <div>Market snapshot: {dmy(t.generatedAt)} · {hhmm(t.generatedAt)}</div>
          {lastRead && <div>Newest holder reading {timeAgo(lastRead, now)}</div>}
        </div>
      </PageHeader>

      {t.status === "no-db" && <Empty>This page needs the site&apos;s holder snapshots (Postgres), which this deployment does not have.</Empty>}
      {t.status === "db-error" && <Empty>The holder readings could not be read just now (the snapshot store did not answer). The worker keeps recording; try again in a minute, or check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → holder_windows.</Empty>}
      {t.status === "collecting" && (
        <Empty>
          Collecting holder readings: none stored yet. Readings are taken once an hour; the 24h column appears after about 20 hours, the 7-day column after about 5½ days.
          {t.quotes.length > 0 && <> {t.quotes.length} quote assets and {t.coins.length} coins are being tracked.</>}
        </Empty>
      )}

      {t.status === "ok" && (
        <Section
          title={`${t.quotes.length} quote assets · ${t.coins.length} coins`}
          action={<span className="num text-xs text-muted">GMGN holder count · StonkFun rewards ledger · stonk.fyi snapshots · hourly</span>}
        >
          <HoldersTable rows={rows} now={now} />
          <div className="mt-4 pt-4 border-t border-border text-sm space-y-1.5 leading-relaxed">
            <p className="font-medium">The two kinds of row count holders differently. Sort within a kind, or compare a row with itself over time.</p>
            <p className="text-secondary text-[13px]">Quote assets: GMGN&apos;s holder count for the mint, every wallet with a balance across all venues, read hourly; assets GMGN does not index show no reading ({withReading} of {t.quotes.length} have one). Coins: StonkFun&apos;s own count of reward-eligible wallets from its rewards ledger, live, with changes from this site&apos;s hourly readings; only reward-mode coins carry a holder figure, so standard-mode coins are not listed. Market cap is shown for coins only. Read / age is the newest reading for a quote asset and time since launch for a coin.</p>
            <div className="flex flex-wrap justify-between gap-2 pt-1 text-xs text-muted num">
              <span>Sources: GMGN · StonkFun rewards · stonk.fyi snapshots · StonkFun market data</span>
              <span>Change columns appear once readings cover 80% of the window</span>
            </div>
          </div>
        </Section>
      )}

      <p className="text-xs text-muted">
        Method on <Link href="/about#holders" className="underline underline-offset-2 hover:text-primary">the About page</Link>. Not financial advice.
      </p>
    </div>
  );
}
