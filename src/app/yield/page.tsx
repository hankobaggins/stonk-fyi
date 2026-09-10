import Link from "next/link";
import { getYieldTable, YIELD_MIN_AGE_HOURS, YIELD_ROWS, type AprCell } from "@/lib/yield";
import { fmtNum, fmtUsd, nowMs, timeAgo } from "@/lib/format";
import { Empty, PageHeader, Section, TokenLink } from "@/components/ui";
import { TradeLink } from "@/components/BuyButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Holder-fee yield" };

const fmtApr = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function AprCol({ c, max, cls }: { c: AprCell; max: number; cls: string }) {
  if (!c) return <span className="text-muted text-xs">collecting</span>;
  const w = max > 0 ? Math.max(2, (c.apr / max) * 100) : 0;
  return (
    <span className="flex items-center gap-3 justify-end" title={`${fmtUsd(c.usd)} paid over ${c.hours.toFixed(1)}h · ${hhmm(c.from)} → ${hhmm(c.to)}`}>
      <span className="aprbar w-24 sm:w-32 shrink-0"><i className={cls} style={{ width: `${w}%` }} /></span>
      <span className={`num text-[15px] font-medium w-20 text-right ${cls}`}>{fmtApr(c.apr)}</span>
    </span>
  );
}

export default async function YieldPage() {
  const now = nowMs();
  const t = await getYieldTable();
  const max1 = Math.max(0, ...t.rows.map((r) => r.d1?.apr ?? 0));
  const max3 = Math.max(0, ...t.rows.map((r) => r.d3?.apr ?? 0));
  const ends = t.rows.map((r) => r.d1?.to ?? r.d3?.to).filter(Boolean) as string[];
  const endsAt = ends.length ? ends.sort()[ends.length - 1] : null;
  const with3d = t.rows.filter((r) => r.d3).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Holder-fee yield"
        sub={`The ${YIELD_ROWS} largest reward coins with at least ${YIELD_MIN_AGE_HOURS} hours of trading history that paid holders inside the last 3 days, ranked by market cap.`}
      >
        <div className="text-right text-xs text-secondary num space-y-0.5">
          <div><span className="pill up">realized holder-fee APR</span></div>
          <div>Market snapshot: {dmy(t.generatedAt)} · {hhmm(t.generatedAt)}</div>
          {endsAt && <div>Both payout windows end at {hhmm(endsAt)}</div>}
        </div>
      </PageHeader>

      {t.status === "no-db" && <Empty>This page needs the site&apos;s payout snapshots (Postgres), which this deployment does not have.</Empty>}
      {t.status === "db-error" && <Empty>The payout readings could not be read just now (the snapshot store did not answer). The worker keeps recording; try again in a minute, or check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → reward_windows.</Empty>}
      {t.status === "collecting" && (
        <Empty>
          Collecting payout readings: {t.historyHours < 1 ? "under an hour" : `${t.historyHours.toFixed(1)} hours`} so far. The 24h column appears after about 20 hours of readings, the 3-day column after about 58.
          {t.candidates > 0 && <> {fmtNum(t.candidates)} reward coins qualify by age and are being tracked.</>}
        </Empty>
      )}

      {t.status === "ok" && (
        <Section
          title="Largest yield-paying coins"
          action={<span className="num text-xs text-muted">stonk.fyi payout snapshots · 5 min · Jupiter prices · 5 min</span>}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="r">#</th>
                  <th>Coin</th>
                  <th className="r">Market cap</th>
                  <th className="r">
                    24h-based APR<br />
                    <span className="normal-case tracking-normal text-[10px]">from the last 24h of payouts</span>
                  </th>
                  <th className="r">
                    3d-based APR<br />
                    <span className="normal-case tracking-normal text-[10px]">average over the last 72h</span>
                  </th>
                  <th>Paid in</th>
                  <th className="r">Fee</th>
                  <th className="r">Last payout</th>
                  <th className="r">Trade</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={r.mint}>
                    <td className="r text-muted num">{String(i + 1).padStart(2, "0")}</td>
                    <td>
                      <TokenLink mint={r.mint}>
                        <span className="font-medium text-[14px]">{r.symbol}</span> <span className="text-muted text-xs">{r.name}</span>
                      </TokenLink>
                    </td>
                    <td className="r num text-[14px]">{fmtUsd(r.marketCapUsd, { compact: true })}</td>
                    <td className="r"><AprCol c={r.d1} max={max1} cls="apr1" /></td>
                    <td className="r"><AprCol c={r.d3} max={max3} cls="apr3" /></td>
                    <td className="font-medium">{r.quoteSymbol}{r.quotePriceUsd === null && <span className="text-muted text-xs"> unpriced</span>}</td>
                    <td className="r num text-muted">{r.transferFeeBps !== null ? `${(r.transferFeeBps / 100).toFixed(1)}%` : "—"}</td>
                    <td className="r num text-muted">{timeAgo(r.lastPayoutAt, now)}</td>
                    <td className="r"><TradeLink mint={r.mint} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-4 border-t border-border text-sm space-y-1.5 leading-relaxed">
            <p className="font-medium">APR is annualized from payouts holders actually received. It is a yield estimate, not a promised return.</p>
            <p className="text-secondary text-[13px]">Payout tokens over each window are from this site&apos;s own 5-minute readings of StonkFun&apos;s reward ledger, valued at the quote asset&apos;s Jupiter price now (STONK at StonkFun&apos;s price), divided by the coin&apos;s market cap now. No compounding, no price change of the coin or its quote asset.</p>
            <p className="text-secondary text-[13px]">Market cap is the denominator because it is the one figure both you and this site can check. Payouts go only to eligible wallets (pools and program accounts are excluded), so a holder&apos;s own yield on eligible balance is higher than the figure shown. The 3d column averages daily payouts over 72 hours; the 24h column moves with the last day alone.</p>
            <div className="flex flex-wrap justify-between gap-2 pt-1 text-xs text-muted num">
              <span>Sources: StonkFun rewards · stonk.fyi snapshots · Jupiter · StonkFun market data</span>
              <span className="text-up">{with3d} / {t.rows.length} have the full 72-hour window</span>
            </div>
          </div>
        </Section>
      )}

      <p className="text-xs text-muted">
        Lifetime payouts per coin, and where the quote-asset prices come from, are on the <Link href="/rewards" className="underline underline-offset-2 hover:text-primary">Rewards page</Link>. How the APR is built is on <Link href="/about#yield" className="underline underline-offset-2 hover:text-primary">the About page</Link>. Not financial advice.
      </p>
    </div>
  );
}
