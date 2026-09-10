import Link from "next/link";
import { CATEGORY_LABEL, getHoldersTable, HOLDERS_TRACKED, STOCK_CATEGORIES, type Change } from "@/lib/holders";
import { fmtNum, fmtUsd, nowMs, timeAgo } from "@/lib/format";
import { resolveImage } from "@/lib/api";
import TokenIcon from "@/components/TokenIcon";
import { Empty, PageHeader, Section, TokenLink } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Holders of stock-quoted assets" };

const COINS_SHOWN = 50;
const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

function ChangeCell({ c }: { c: Change }) {
  if (!c) return <span className="text-muted text-xs">collecting</span>;
  const cls = c.abs > 0 ? "text-up" : c.abs < 0 ? "text-down" : "text-muted";
  return (
    <span className="num" title={`${fmtNum(c.abs + 0)} over ${c.hours.toFixed(1)}h · ${hhmm(c.from)} → ${hhmm(c.to)}`}>
      <span className={`${cls} text-[14px]`}>{signed(c.abs)}</span>
      {c.pct !== null && <span className="text-muted text-xs"> {c.pct > 0 ? "+" : ""}{c.pct.toFixed(1)}%</span>}
    </span>
  );
}

export default async function HoldersPage() {
  const now = nowMs();
  const t = await getHoldersTable();
  const coins = t.coins.slice(0, COINS_SHOWN);
  const reads = t.quotes.map((q) => q.readAt).filter(Boolean) as string[];
  const lastRead = reads.length ? reads.sort()[reads.length - 1] : null;
  const withReading = t.quotes.filter((q) => q.holders !== null).length;

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
        <>
          <Section
            title="Quote assets"
            action={<span className="num text-xs text-muted">GMGN holder count · stonk.fyi snapshots · hourly</span>}
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Provider</th>
                    <th className="r">Holders</th>
                    <th className="r">24h</th>
                    <th className="r">7d</th>
                    <th className="r">Read</th>
                  </tr>
                </thead>
                <tbody>
                  {STOCK_CATEGORIES.flatMap((cat) =>
                    t.quotes
                      .filter((q) => q.category === cat)
                      .sort((a, b) => (b.holders ?? -1) - (a.holders ?? -1))
                      .map((q) => (
                        <tr key={q.mint}>
                          <td>
                            <a href={`https://gmgn.ai/sol/token/${q.mint}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-accent">
                              <TokenIcon src={resolveImage(q.logoUrl)} symbol={q.symbol} size={20} />
                              <span className="font-medium text-[14px]">{q.symbol}</span>
                              <span className="text-muted text-xs truncate max-w-[16rem]">{q.name}</span>
                            </a>
                          </td>
                          <td className="text-secondary text-xs">{CATEGORY_LABEL[cat]}</td>
                          <td className="r num text-[14px]">{q.holders === null ? <span className="text-muted text-xs">no reading</span> : fmtNum(q.holders)}</td>
                          <td className="r"><ChangeCell c={q.d1} /></td>
                          <td className="r"><ChangeCell c={q.d7} /></td>
                          <td className="r num text-muted text-xs">{q.readAt ? timeAgo(q.readAt, now) : "—"}</td>
                        </tr>
                      )),
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted num">
              <span>Holder count as GMGN reports it for the mint (every wallet with a balance, across all venues). Quote assets GMGN does not index show no reading.</span>
              <span>{withReading} / {t.quotes.length} with a reading</span>
            </div>
          </Section>

          <Section
            title={`Largest coins quoted in them · top ${coins.length} of ${t.coins.length} tracked`}
            action={<span className="num text-xs text-muted">StonkFun rewards ledger · stonk.fyi snapshots · hourly</span>}
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="r">#</th>
                    <th>Coin</th>
                    <th>Quote</th>
                    <th className="r">Market cap</th>
                    <th className="r">Holders</th>
                    <th className="r">24h</th>
                    <th className="r">7d</th>
                    <th className="r">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {coins.map((c, i) => (
                    <tr key={c.mint}>
                      <td className="r text-muted num">{String(i + 1).padStart(2, "0")}</td>
                      <td>
                        <TokenLink mint={c.mint}>
                          <span className="font-medium text-[14px]">{c.symbol}</span> <span className="text-muted text-xs">{c.name}</span>
                        </TokenLink>
                      </td>
                      <td className="text-secondary text-xs">{c.quoteSymbol} <span className="text-muted">· {CATEGORY_LABEL[c.quoteCategory] ?? c.quoteCategory}</span></td>
                      <td className="r num text-[14px]">{fmtUsd(c.marketCapUsd, { compact: true })}</td>
                      <td className="r num text-[14px]">{fmtNum(c.holders)}</td>
                      <td className="r"><ChangeCell c={c.d1} /></td>
                      <td className="r"><ChangeCell c={c.d7} /></td>
                      <td className="r num text-muted text-xs">{timeAgo(c.createdAt, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-xs text-muted">
              Holders here is StonkFun&apos;s own count of reward-eligible wallets for the coin (the figure in its rewards ledger), live; the changes are from this site&apos;s hourly readings of it. Only reward-mode coins have a holder figure in the API, so standard-mode coins are not listed. Ranked by market cap.
            </div>
          </Section>
        </>
      )}

      <p className="text-xs text-muted">
        The two holder counts are different measures from different providers and are not comparable with each other. A window is shown once readings cover at least 80% of it. Method on <Link href="/about#holders" className="underline underline-offset-2 hover:text-primary">the About page</Link>. Not financial advice.
      </p>
    </div>
  );
}
