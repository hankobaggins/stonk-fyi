import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { getToken, getTokenBacking, getTokenBurns, getTokenFees, getTokenRewards, resolveImage, SITE_BASE } from "@/lib/api";
import { getUsdPrices } from "@/lib/jupiter";
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd, nowMs, shortAddr, timeAgo } from "@/lib/format";
import { Delta, ExplorerLink, KpiTile, ModePill, Section, StatusPill } from "@/components/ui";
import TokenIcon from "@/components/TokenIcon";
import TokenHistoryChart from "@/components/TokenHistoryChart";
import { getTokenHistory } from "@/lib/db";
import { getCoinHolderDelta } from "@/lib/universe";
import BuyButton from "@/components/BuyButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/tokens/[mint]">) {
  const { mint } = await params;
  const t = await getToken(mint);
  return { title: t ? `${t.data.token.symbol} / ${t.data.token.quote.symbol}` : "Token" };
}

// Each extra is fetched independently: a failure (upstream 5xx, timeout) hides that section only.
async function settle<T>(p: Promise<T | null>): Promise<{ data: T | null; failed: boolean }> {
  try {
    return { data: await p, failed: false };
  } catch {
    return { data: null, failed: true };
  }
}

function Unavailable({ what }: { what: string }) {
  return <div className="text-xs text-muted">{what} didn&apos;t load from the StonkFun API. It refreshes with the page.</div>;
}

export default async function TokenPage({ params }: PageProps<"/tokens/[mint]">) {
  const { mint } = await params;
  const res = await getToken(mint);
  if (!res) notFound();
  const t = res.data.token;
  const launch = res.data.launch;
  const m = t.market ?? {};
  const now = nowMs();
  const [burns, rewards, fees, backing, history, holderDelta] = await Promise.all([
    settle(getTokenBurns(mint)),
    settle(getTokenRewards(mint)),
    settle(getTokenFees(mint)),
    settle(getTokenBacking(mint)),
    settle(getTokenHistory(mint, 7)),
    settle(getCoinHolderDelta(mint)),
  ]);
  const hist = history.data;
  const img = resolveImage(t.imageUrl);
  const drawdown = m.peakMarketCapUsd && m.marketCapUsd ? ((m.marketCapUsd - m.peakMarketCapUsd) / m.peakMarketCapUsd) * 100 : undefined;
  const timeToGraduate = t.graduatedAt ? (Date.parse(t.graduatedAt) - Date.parse(t.createdAt)) / 60000 : undefined;
  const rw = rewards.data?.rewards ?? null;
  const quote = rewards.data?.quote ?? null;
  // Reward payouts arrive in native quote units; mark them to Jupiter's current price (5 min cache). Best-effort: null when unpriced.
  const quotePrice = rw && quote?.mint ? ((await getUsdPrices([quote.mint]))[quote.mint] ?? null) : null;
  const distributedUsdNow = quotePrice != null ? rw!.distributedTokens * quotePrice : null;
  const fe = fees.data;
  const avgPerHolder = rw && rw.holderCount > 0 && m.marketCapUsd ? m.marketCapUsd / rw.holderCount : null;
  const hd = holderDelta.data;
  // Backing (Pump launches only): flatten the API's object into label · value rows; hidden when it returns nothing.
  const backingRows: [string, string][] = Object.entries(backing.data ?? {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => [k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase(), typeof v === "number" ? fmtNum(v, v < 100 ? 4 : 0) : String(v)]);
  const signed = (n: number) => (n >= 0 ? `+${fmtNum(n)}` : `−${fmtNum(-n)}`);
  const hdParts = hd ? ([["24h", hd.d1], ["7d", hd.d7], ["14d", hd.d14], ["30d", hd.d30]] as const).filter(([, v]) => v !== null).map(([k, v]) => `${signed(v as number)} ${k}`) : [];

  return (
    <div className="space-y-5">
      <nav className="num text-xs text-muted flex gap-2" aria-label="Breadcrumb">
        <Link href="/tokens" className="text-secondary hover:text-primary">Tokens</Link><span>/</span><span className="text-primary">{t.symbol}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-4 border-b border-border">
        <div className="flex items-center gap-4 min-w-0">
          <TokenIcon src={img} symbol={t.symbol} size={56} />
          <div className="flex flex-col gap-2 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight flex items-baseline gap-2.5 flex-wrap">
              {t.symbol} <span className="num text-sm text-muted font-normal">/ {t.quote.symbol}</span><span className="text-sm text-secondary font-normal">{t.name}</span>
            </h1>
            <div className="flex flex-wrap gap-1.5">
              <StatusPill status={t.status} progress={t.graduationProgress} />
              <ModePill mode={t.mode} bps={t.transferFee?.bps} />
              {t.flywheel?.active && <span className="pill">flywheel</span>}
              {t.launchpad && <span className="pill">{t.launchpad}</span>}
              {t.quote.categoryLabel && <span className="pill">{t.quote.categoryLabel} pair</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <div className="flex flex-wrap gap-2 items-center">
            <BuyButton mint={t.mint} symbol={t.symbol} size="sm" />
            <a href={`${SITE_BASE}/token/${t.mint}`} target="_blank" rel="noreferrer" className="btn-ghost">StonkFun ↗</a>
            {t.links?.twitter && <a href={t.links.twitter} target="_blank" rel="noreferrer" className="btn-ghost">Twitter ↗</a>}
            {t.links?.website && <a href={t.links.website} target="_blank" rel="noreferrer" className="btn-ghost">Website ↗</a>}
          </div>
          <span className="num text-[11px] text-muted">snapshot {timeAgo(res.meta.generatedAt, now)} · refreshes every 60s</span>
        </div>
      </div>

      <div className="kpis">
        <KpiTile label="Price" value={fmtPrice(m.priceUsd)} delta={m.priceChange24h} sub="24h" />
        <KpiTile label="Market cap" value={fmtUsd(m.marketCapUsd)} sub={`peak ${fmtUsd(m.peakMarketCapUsd)}`} />
        <KpiTile label="24h volume" value={fmtUsd(m.volume24hUsd)} sub={m.marketCapUsd && m.volume24hUsd ? `${(m.volume24hUsd / m.marketCapUsd).toFixed(2)}× market cap` : undefined} />
        <KpiTile label="From peak" value={<Delta value={drawdown} />} sub={m.liquidityUsd ? `liquidity ${fmtUsd(m.liquidityUsd)}` : undefined} />
      </div>

      <Section title="History, 7d" action={hist ? <span className="num text-[11px] text-muted">{fmtNum(hist.samples)} snapshots · since {timeAgo(hist.from, now)} · stonk.fyi snapshots · 5 min</span> : null}>
        {hist ? (
          <TokenHistoryChart points={hist.points} />
        ) : (
          <div className="h-[160px] rounded-md border border-dashed border-border-strong flex flex-col items-center justify-center text-center gap-1.5 px-4">
            <span className="state collecting">collecting</span>
            <span className="text-[13px] text-secondary">No history recorded yet; the chart appears after the second snapshot.</span>
            <span className="num text-[11px] text-muted">top 100 by volume every 5 min · top 500 hourly · every token daily</span>
          </div>
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Launch" action={<span className="num text-[11px] text-muted">StonkFun · 60s</span>}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
            <dt className="text-muted">Created</dt><dd className="num text-right">{fmtDate(t.createdAt)} <span className="text-muted">· {timeAgo(t.createdAt, now)}</span></dd>
            <dt className="text-muted">Graduated</dt><dd className="num text-right">{t.graduatedAt ? (timeToGraduate !== undefined ? `${fmtNum(timeToGraduate)} min after launch` : fmtDate(t.graduatedAt)) : `not yet · ${fmtPct((t.graduationProgress ?? 0) * 100, 0).replace("+", "")}`}</dd>
            <dt className="text-muted">Mode</dt><dd className="num text-right">{t.mode}{t.transferFee ? ` · ${t.transferFee.bps / 100}% transfer tax to holders` : ""}{t.quoteOnlyFees ? " · quote-only fees" : ""}</dd>
            <dt className="text-muted">Launchpad</dt><dd className="num text-right">{t.launchpad ?? "—"}</dd>
            {launch && (<><dt className="text-muted">Start market cap</dt><dd className="num text-right">{fmtUsd(launch.startMarketCapUsd)}{launch.targetMarketCapUsd ? <span className="text-muted"> · target {fmtUsd(launch.targetMarketCapUsd)}</span> : null}</dd></>)}
            <dt className="text-muted">Creator</dt><dd className="text-right">{(t.creator ?? launch?.creator) ? <ExplorerLink addr={(t.creator ?? launch?.creator)!} label={`${shortAddr((t.creator ?? launch?.creator)!)} ↗`} /> : <span className="text-muted">—</span>}</dd>
          </dl>
        </Section>
        <Section title="Addresses" action={<span className="num text-[11px] text-muted">Solscan ↗</span>}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
            <dt className="text-muted">Mint</dt><dd className="text-right truncate"><ExplorerLink addr={t.mint} kind="token" label={`${shortAddr(t.mint, 6)} ↗`} /></dd>
            <dt className="text-muted">Pool</dt><dd className="text-right truncate">{t.pool ? <ExplorerLink addr={t.pool} label={`${shortAddr(t.pool)} ↗`} /> : "—"}</dd>
            <dt className="text-muted">Quote mint</dt><dd className="num text-right truncate"><Link href={`/tokens?quoteMint=${t.quote.mint}`} className="text-secondary hover:text-primary">{t.quote.symbol}</Link> <span className="text-muted">· </span><ExplorerLink addr={t.quote.mint} kind="token" label={`${shortAddr(t.quote.mint)} ↗`} /></dd>
            {t.metadataUri && (<><dt className="text-muted">Metadata URI</dt><dd className="text-right truncate"><a href={t.metadataUri} target="_blank" rel="noreferrer" className="text-xs font-mono text-secondary hover:text-accent">{t.metadataUri.replace(/^https?:\/\//, "").slice(0, 28)}… ↗</a></dd></>)}
          </dl>
          {backingRows.length > 0 && (
            <div className="mt-3.5 pt-2.5 border-t border-border">
              <div className="label mb-2">Backing <span className="text-muted normal-case tracking-normal">· Pump launches only</span></div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
                {backingRows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{k}</dt><dd className="num text-right truncate">{v}</dd></Fragment>))}
              </dl>
            </div>
          )}
        </Section>
      </div>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        <Section title="Holder rewards" action={rw?.lastPayoutAt ? <span className="num text-[11px] text-muted">last payout {timeAgo(rw.lastPayoutAt, now)}</span> : null}>
          {rewards.failed ? (
            <Unavailable what="Rewards" />
          ) : rw ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Mini label="Distributed" value={`${fmtNum(rw.distributedTokens, 2)} ${quote?.symbol ?? ""}`} />
                <Mini label="At today's price" value={distributedUsdNow != null ? fmtUsd(distributedUsdNow) : "—"} />
                <Mini label="Payouts" value={fmtNum(rw.payoutCount)} />
                <Mini label="Holders paid" value={fmtNum(rw.holderCount)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2.5">
                <Mini label="Avg per holder" value={avgPerHolder !== null ? fmtUsd(avgPerHolder) : "—"} />
                {hdParts.length > 0 && (
                  <div className="min-w-0 border border-border rounded-md px-3 py-2.5">
                    <div className="label">Holders change · HolderScan</div>
                    <div className="num text-xs mt-2 flex flex-wrap gap-x-2">
                      {hdParts.map((x) => <span key={x} className={x.startsWith("+") ? "text-up" : "text-down"}>{x}</span>)}
                      <span className="text-muted">· read {timeAgo(hd!.ts, now)}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="method">
                <strong>
                  {quotePrice != null
                    ? <>&quot;At today&apos;s price&quot; values every payout at the current {quote?.symbol} price, {fmtPrice(quotePrice)}, not the price at each payout.</>
                    : <>No current USD price for {quote?.symbol ?? "this quote asset"}, so payouts are in native units only.</>}
                </strong>
                <span className="num text-[11px] text-muted ml-auto">StonkFun rewards · 60s{rw ? " · Jupiter · 5 min" : ""}{hdParts.length ? " · HolderScan · daily" : ""}</span>
              </div>
              <p className="text-xs text-muted mt-2">Trading fees paid to holders in {quote?.symbol ?? "the quote asset"}, pro rata. Average per holder is market cap ÷ holders paid, so pool-held supply is in the numerator.</p>
            </>
          ) : (
            <>
              <div className="text-xs text-muted">{rewards.data?.message ?? "Standard launch: fees are split with the creator, not paid to holders."}</div>
              <div className="mt-2 src">StonkFun rewards · 60s</div>
            </>
          )}
        </Section>

        <div className="grid gap-4">
          <Section title="Creator fees" action={<span className="num text-[11px] text-muted">StonkFun · 60s</span>}>
            {fees.failed ? (
              <Unavailable what="Creator fees" />
            ) : fe?.claimable ? (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <Mini label={`Claimable ${fe.claimable.base.symbol}`} value={fmtNum(fe.claimable.base.amountTokens, 2)} />
                  <Mini label={`Claimable ${fe.claimable.quote.symbol}`} value={fmtNum(fe.claimable.quote.amountTokens, 4)} />
                </div>
                <p className="text-xs text-muted mt-2.5">Unclaimed by the creator; claimable at any time{fe.creator ? <> · <ExplorerLink addr={fe.creator} label={`${shortAddr(fe.creator)} ↗`} /></> : null}.</p>
              </>
            ) : (
              <div className="text-xs text-muted">{fe?.reason ?? "No creator-claimable fees."}</div>
            )}
          </Section>

          <Section title="Burns" action={burns.data ? <span className="num text-[11px] text-muted">on-chain · 60s · last {timeAgo(burns.data.totals.lastBurnAt, now)}</span> : null}>
            {burns.failed ? (
              <Unavailable what="The burn ledger" />
            ) : burns.data && burns.data.burns.length ? (
              <>
                <div className="grid grid-cols-3 gap-2.5 mb-2.5">
                  <Mini label="Burned" value={`${fmtNum(burns.data.totals.amountTokens)} ${t.symbol}`} />
                  <Mini label="USD at burn" value={fmtUsd(burns.data.totals.valueUsdAtBurn)} />
                  <Mini label="Burn events" value={fmtNum(burns.data.totals.burnCount)} />
                </div>
                <div className="table-wrap max-h-[200px] overflow-y-auto">
                  <table className="data">
                    <thead><tr><th>When</th><th className="r">{t.symbol}</th><th className="r">USD</th><th>Source</th><th className="r">Tx</th></tr></thead>
                    <tbody>
                      {burns.data.burns.slice(0, 20).map((b) => (
                        <tr key={b.signature}>
                          <td className="text-secondary">{timeAgo(b.burnedAt, now)}</td>
                          <td className="r">{fmtNum(b.amountTokens, 2)}</td>
                          <td className="r">{fmtUsd(b.valueUsdAtBurn)}</td>
                          <td className="text-secondary">{b.source}</td>
                          <td className="r"><ExplorerLink addr={b.signature} kind="tx" label={`${shortAddr(b.signature, 4)} ↗`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="num text-[11px] text-muted mt-2">the most recent {burns.data.burns.length} of {fmtNum(burns.data.totals.burnCount)} · StonkFun burn ledger</p>
              </>
            ) : (
              <div className="text-xs text-muted">No burns recorded for this token.</div>
            )}
          </Section>
        </div>
      </div>

    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-border rounded-md px-3 py-2.5">
      <div className="label">{label}</div>
      <div className="num text-[20px] font-medium tracking-tight mt-1.5 truncate">{value}</div>
    </div>
  );
}
