import Link from "next/link";
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
  const signed = (n: number) => (n >= 0 ? `+${fmtNum(n)}` : `−${fmtNum(-n)}`);
  const hdParts = hd ? ([["24h", hd.d1], ["7d", hd.d7], ["14d", hd.d14], ["30d", hd.d30]] as const).filter(([, v]) => v !== null).map(([k, v]) => `${signed(v as number)} ${k}`) : [];

  return (
    <div className="space-y-5">
      <div className="text-xs text-muted">
        <Link href="/tokens" className="hover:text-primary">Tokens</Link> / {t.symbol}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <TokenIcon src={img} symbol={t.symbol} size={56} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
            {t.symbol} <span className="text-muted font-normal text-lg">/ {t.quote.symbol}</span>
          </h1>
          <div className="text-sm text-secondary">{t.name}</div>
          <div className="flex flex-wrap gap-2 mt-2">
            <StatusPill status={t.status} progress={t.graduationProgress} />
            <ModePill mode={t.mode} bps={t.transferFee?.bps} />
            {t.flywheel?.active && <span className="pill up">flywheel</span>}
            {t.launchpad && <span className="pill">{t.launchpad}</span>}
            {t.quote.categoryLabel && <span className="pill">{t.quote.categoryLabel} pair</span>}
          </div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1 text-xs">
          <BuyButton mint={t.mint} symbol={t.symbol} size="sm" className="mb-1" />
          <a href={`${SITE_BASE}/token/${t.mint}`} target="_blank" rel="noreferrer" className="text-secondary hover:text-accent">Open on StonkFun ↗</a>
          {t.links?.twitter && <a href={t.links.twitter} target="_blank" rel="noreferrer" className="text-secondary hover:text-accent">Twitter ↗</a>}
          {t.links?.website && <a href={t.links.website} target="_blank" rel="noreferrer" className="text-secondary hover:text-accent">Website ↗</a>}
          <span className="num text-muted">snapshot {timeAgo(res.meta.generatedAt, now)} · refreshes every 60s</span>
        </div>
      </div>

      <div className="kpis">
        <KpiTile label="Price" value={fmtPrice(m.priceUsd)} delta={m.priceChange24h} sub="24h" />
        <KpiTile label="Market cap" value={fmtUsd(m.marketCapUsd)} sub={`peak ${fmtUsd(m.peakMarketCapUsd)}`} />
        <KpiTile label="24h volume" value={fmtUsd(m.volume24hUsd)} sub={m.marketCapUsd && m.volume24hUsd ? `${(m.volume24hUsd / m.marketCapUsd).toFixed(2)}× market cap` : undefined} />
        <KpiTile label="From peak" value={<Delta value={drawdown} />} sub={m.liquidityUsd ? `liquidity ${fmtUsd(m.liquidityUsd)}` : undefined} />
      </div>

      <Section title="History, 7d" action={hist ? <span className="num text-xs text-muted">{fmtNum(hist.samples)} snapshots · since {timeAgo(hist.from, now)} · stonk.fyi snapshots · 5 min</span> : null}>
        {hist ? (
          <TokenHistoryChart points={hist.points} />
        ) : (
          <div className="text-sm text-muted">
            No history recorded yet. stonk.fyi snapshots the top 100 tokens by volume every 5 minutes, the top 500 hourly and every token daily; the chart
            appears after the second snapshot.
          </div>
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Launch">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">Created</dt><dd className="num">{fmtDate(t.createdAt)} <span className="text-muted">({timeAgo(t.createdAt, now)})</span></dd>
            <dt className="text-muted">Graduated</dt><dd className="num">{t.graduatedAt ? `${fmtDate(t.graduatedAt)} · ${timeToGraduate !== undefined ? `${fmtNum(timeToGraduate)} min after launch` : ""}` : `not yet · ${fmtPct((t.graduationProgress ?? 0) * 100, 0).replace("+", "")}`}</dd>
            <dt className="text-muted">Mode</dt><dd>{t.mode}{t.transferFee ? ` · ${t.transferFee.bps / 100}% transfer tax to holders` : ""}{t.quoteOnlyFees ? " · quote-only fees" : ""}</dd>
            <dt className="text-muted">Launchpad</dt><dd>{t.launchpad ?? "—"}</dd>
            {launch && (<><dt className="text-muted">Start market cap</dt><dd className="num">{fmtUsd(launch.startMarketCapUsd)}{launch.targetMarketCapUsd ? <span className="text-muted"> (target {fmtUsd(launch.targetMarketCapUsd)})</span> : null}</dd></>)}
            <dt className="text-muted">Creator</dt><dd>{(t.creator ?? launch?.creator) ? <ExplorerLink addr={(t.creator ?? launch?.creator)!} /> : <span className="text-muted">—</span>}</dd>
          </dl>
        </Section>
        <Section title="Addresses">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">Mint</dt><dd className="truncate"><ExplorerLink addr={t.mint} kind="token" /></dd>
            <dt className="text-muted">Pool</dt><dd className="truncate">{t.pool ? <ExplorerLink addr={t.pool} /> : "—"}</dd>
            <dt className="text-muted">Quote mint</dt><dd className="truncate"><ExplorerLink addr={t.quote.mint} kind="token" /> <span className="text-muted">({t.quote.name ?? t.quote.symbol})</span></dd>
            {t.metadataUri && (<><dt className="text-muted">Metadata</dt><dd className="truncate"><a href={t.metadataUri} target="_blank" rel="noreferrer" className="text-xs font-mono text-secondary hover:text-accent">{t.metadataUri}</a></dd></>)}
          </dl>
        </Section>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Holder rewards" action={rw?.lastPayoutAt ? <span className="num text-xs text-muted">last payout {timeAgo(rw.lastPayoutAt, now)}</span> : null}>
          {rewards.failed ? (
            <Unavailable what="Rewards" />
          ) : rw ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Mini label="Distributed" value={`${fmtNum(rw.distributedTokens, 2)} ${quote?.symbol ?? ""}`} />
                <Mini label="At today's price" value={distributedUsdNow != null ? fmtUsd(distributedUsdNow) : "—"} />
                <Mini label="Payouts" value={fmtNum(rw.payoutCount)} />
                <Mini label="Holders paid" value={fmtNum(rw.holderCount)} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <Mini label="Avg per holder" value={avgPerHolder !== null ? fmtUsd(avgPerHolder) : "—"} />
                {hdParts.length > 0 && (
                  <div className="min-w-0 sm:col-span-3">
                    <div className="label">Holders change · HolderScan</div>
                    <div className="num text-sm mt-1.5 flex flex-wrap gap-x-3">
                      {hdParts.map((x) => <span key={x} className={x.startsWith("+") ? "text-up" : "text-down"}>{x}</span>)}
                      <span className="text-muted">read {timeAgo(hd!.ts, now)}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="text-xs text-muted mt-3">
                Trading fees paid to holders in {quote?.symbol ?? "the quote asset"}, pro rata. Average per holder is market cap ÷ holders paid, so pool-held supply is in the numerator.{" "}
                {quotePrice != null ? (
                  <>
                    USD is marked to {quote?.symbol}&apos;s current price, <span className="num">{fmtPrice(quotePrice)}</span>, not the
                    price at each payout.
                  </>
                ) : (
                  <>No current USD price for {quote?.symbol ?? "this quote asset"}, so payouts are shown in native units only.</>
                )}
              </div>
            </>
          ) : (
            <div className="text-xs text-muted">{rewards.data?.message ?? "Standard launch: fees are split with the creator, not paid to holders."}</div>
          )}
          <div className="mt-2 src">StonkFun rewards · 60s{rw ? " · Jupiter price · 5 min" : ""}{hdParts.length ? " · HolderScan deltas · daily" : ""}</div>
        </Section>

        <Section title="Creator fees">
          {fees.failed ? (
            <Unavailable what="Creator fees" />
          ) : fe?.claimable ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Mini label={`Claimable ${fe.claimable.base.symbol}`} value={fmtNum(fe.claimable.base.amountTokens, 2)} />
                <Mini label={`Claimable ${fe.claimable.quote.symbol}`} value={fmtNum(fe.claimable.quote.amountTokens, 4)} />
              </div>
              <div className="text-xs text-muted mt-3">
                Unclaimed creator share of trading fees{fe.creator ? <> · creator <ExplorerLink addr={fe.creator} label={shortAddr(fe.creator)} /></> : null}.
              </div>
            </>
          ) : (
            <div className="text-xs text-muted">{fe?.reason ?? "No creator-claimable fees."}</div>
          )}
          <div className="mt-2 src">StonkFun fees · 60s</div>
        </Section>
      </div>

      <Section title="Burns" action={burns.data ? <span className="num text-xs text-muted">last {timeAgo(burns.data.totals.lastBurnAt, now)}</span> : null}>
        {burns.failed ? (
          <Unavailable what="The burn ledger" />
        ) : burns.data && burns.data.burns.length ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Mini label="Burned" value={`${fmtNum(burns.data.totals.amountTokens)} ${t.symbol}`} />
              <Mini label="USD at burn" value={fmtUsd(burns.data.totals.valueUsdAtBurn)} />
              <Mini label="Burn events" value={fmtNum(burns.data.totals.burnCount)} />
            </div>
            <div className="table-wrap max-h-72 overflow-y-auto">
              <table className="data">
                <thead><tr><th>When</th><th className="r">{t.symbol}</th><th className="r">USD</th><th>Source</th><th>Tx</th></tr></thead>
                <tbody>
                  {burns.data.burns.slice(0, 20).map((b) => (
                    <tr key={b.signature}>
                      <td className="text-muted num">{timeAgo(b.burnedAt, now)}</td>
                      <td className="r num">{fmtNum(b.amountTokens, 2)}</td>
                      <td className="r num">{fmtUsd(b.valueUsdAtBurn)}</td>
                      <td className="text-secondary">{b.source}</td>
                      <td><ExplorerLink addr={b.signature} kind="tx" label={shortAddr(b.signature, 5)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-muted mt-2">Platform fee sweeps burned on-chain; the API returns the most recent {burns.data.burns.length} of {fmtNum(burns.data.totals.burnCount)}.</div>
          </>
        ) : (
          <div className="text-xs text-muted">No burns recorded for this token.</div>
        )}
        <div className="mt-2 src">StonkFun burn ledger · 60s</div>
      </Section>

      {backing.data && (
        <Section title="Backing">
          <pre className="text-xs font-mono text-secondary overflow-x-auto whitespace-pre">{JSON.stringify(backing.data, null, 2)}</pre>
        </Section>
      )}

    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="num text-lg font-medium mt-1 truncate">{value}</div>
    </div>
  );
}
