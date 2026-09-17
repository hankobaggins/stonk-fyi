import Link from "next/link";
import { getStonkData } from "@/lib/stonk";
import { STONK_MINT } from "@/lib/api";
import { fmtDate, fmtNum, fmtPrice, fmtUsd, nowMs, shortAddr, timeAgo } from "@/lib/format";
import { Delta, ExplorerLink, KpiTile, Section } from "@/components/ui";
import { CountBarChart, PriceChart } from "@/components/charts";
import Scorecard from "@/components/Scorecard";
import TallyBar from "@/components/TallyBar";
import Foundation from "@/components/Foundation";
import { GMGN_TOKEN_URL } from "@/lib/gmgn";
import TokenTable from "@/components/TokenTable";
import Projection from "@/components/Projection";
import BuyButton, { PerpsButton } from "@/components/BuyButton";
import HolderBase from "@/components/HolderBase";

export const dynamic = "force-dynamic";

// The product: hero → foundation → tally → 4 KPIs → scorecard (all 20 cells, compact) → what to watch → holder base
// → price → buybacks-per-day estimate + burn list → pool + projection → tokens priced in STONK. The buyback feed and
// the cumulative spend chart live on /flywheel (redesign 2026-09-13, Rationale §2).
export default async function StonkPage() {
  const now = nowMs();
  const d = await getStonkData();
  const t = d.token;
  const m = t.market ?? {};
  const r = d.revenue;

  // Buyback dollars per day ≈ buyback share × daily revenue (the flywheel's fuel line). An estimate; the ledger is on /flywheel.
  const buybackShare = r.revenue.totalRevenueUsd ? r.revenue.totalBuybackUsd / r.revenue.totalRevenueUsd : 0;
  const buybackSeries = d.days.map((x) => ({ date: x.date, value: x.dailyRevenue * buybackShare }));
  const burns = (d.burns?.burns ?? []).slice(0, 8);

  const medianPerHolder = d.holders?.latest.stats?.medianPosition && m.priceUsd ? d.holders.latest.stats.medianPosition * m.priceUsd : null;
  const perHolderMcap = m.marketCapUsd ?? d.holders?.latest.marketCapUsd ?? null;
  const perHolder = d.holders && perHolderMcap && d.holders.latest.holders > 0 ? perHolderMcap / d.holders.latest.holders : null;
  const fromPeak = m.peakMarketCapUsd && m.marketCapUsd ? ((m.marketCapUsd - m.peakMarketCapUsd) / m.peakMarketCapUsd) * 100 : undefined;
  const spread = d.gmgn && d.gmgn.priceUsd > 0 && m.priceUsd ? (d.gmgn.priceUsd / m.priceUsd - 1) * 100 : null;

  return (
    <div className="space-y-6">
      {/* A · Hero: text left, price right; on phones the price block comes first and the Buy button goes full width. */}
      <div className="grid md:grid-cols-[1.2fr_1fr] gap-x-8 gap-y-5 items-end pb-1">
        <div className="order-2 md:order-1">
          <div className="label mb-2.5">Platform token · StonkFun launchpad · Solana</div>
          <h1 className="text-[32px] md:text-[40px] leading-none font-semibold tracking-tighter flex items-baseline gap-3.5 flex-wrap">
            $STONK <span className="num text-[13px] tracking-normal font-normal text-muted">paired with SPYx</span>
          </h1>
          <p className="text-sm text-secondary mt-2.5 max-w-[62ch] leading-normal">
            Fee revenue buys STONK and burns it, on-chain.{" "}
            <span className="whitespace-nowrap"><ExplorerLink addr={STONK_MINT} kind="token" label={shortAddr(STONK_MINT, 6)} /></span>
          </p>
        </div>
        <div className="order-1 md:order-2 flex flex-col items-start md:items-end md:text-right gap-2">
          <div className="num text-[44px] md:text-[54px] leading-none font-medium tracking-tighter">{fmtPrice(m.priceUsd)}</div>
          <div className="num text-[13px] text-secondary flex flex-wrap gap-x-2.5 items-baseline md:justify-end">
            <span><Delta value={m.priceChange24h} /> 24h</span>
            <span className="text-muted">· StonkFun snapshot {timeAgo(d.generatedAt, now)}</span>
          </div>
          {spread !== null && d.gmgn ? (
            <div className={`num text-[12px] ${Math.abs(spread) > 3 ? "text-caution" : "text-muted"}`}>
              <a href={GMGN_TOKEN_URL} target="_blank" rel="noreferrer" className="hover:text-accent">GMGN</a> {fmtPrice(d.gmgn.priceUsd)} · {spread >= 0 ? "+" : "−"}{Math.abs(spread).toFixed(1)}% vs StonkFun
              {d.gmgn.biggestPool && <> · {d.gmgn.biggestPool.exchange} STONK/{d.gmgn.biggestPool.quoteSymbol}</>}
            </div>
          ) : (
            <div className="num text-[12px] text-muted">GMGN unavailable · one reference price on this read</div>
          )}
          <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 md:flex gap-2 w-full md:w-auto md:justify-end">
            <BuyButton mint={STONK_MINT} size="lg" className="w-full md:w-auto min-h-11" />
            <PerpsButton size="lg" className="w-full md:w-auto min-h-11" />
          </div>
        </div>
      </div>

      {/* B · Foundation: unscored, one-way facts. */}
      <Foundation d={d} now={now} />

      {/* C · Tally: dashed segments stand in for a whole missing group. */}
      <div>
        <TallyBar indicators={d.indicators} />
        <p className="text-[12.5px] text-muted mt-2.5">Only quantities that can move both ways are scored; this tally will turn. <Link href="/about#scored" className="text-secondary hover:text-primary">How each one is computed →</Link></p>
      </div>

      {/* D · KPIs, with fallback tiles when HolderScan is missing. */}
      <div className="kpis">
        <KpiTile label="Market cap" value={fmtUsd(m.marketCapUsd)} delta={fromPeak} sub="from peak" />
        <KpiTile label="24h volume" value={fmtUsd(m.volume24hUsd)} sub={m.marketCapUsd && m.volume24hUsd ? `${((m.volume24hUsd / m.marketCapUsd) * 100).toFixed(1)}% of market cap` : undefined} />
        {d.holders
          ? <KpiTile label="Average per holder" value={perHolder !== null ? fmtUsd(perHolder) : "—"} sub={`${medianPerHolder !== null ? `median ${fmtUsd(medianPerHolder)} · ` : ""}market cap ÷ ${fmtNum(d.holders.latest.holders)} holders`} />
          : d.gmgn
          ? <KpiTile label="Holders" value={fmtNum(d.gmgn.holderCount)} sub={`${fmtNum(d.gmgn.wallets.smart)} smart money · ${fmtNum(d.gmgn.wallets.kol)} KOL · GMGN`} />
          : <KpiTile label="Circulating supply" value={fmtNum(d.supply.circulating)} sub="holders unavailable · HolderScan" />}
        <KpiTile label="Peak market cap" value={fmtUsd(m.peakMarketCapUsd)} sub="all-time high" />
      </div>

      {/* E + F · Scorecard and What to watch. */}
      <Scorecard indicators={d.indicators} watch={d.watch} />

      {/* G · Holder base (HolderScan, worker readings). */}
      {d.holders && <HolderBase h={d.holders} mint={STONK_MINT} marketCapUsd={m.marketCapUsd ?? null} priceUsd={m.priceUsd ?? null} now={now} />}

      {/* H · Price. */}
      <Section title="Price (USD)" action={d.history ? <span className="num text-[11px] text-muted">CoinGecko · 90d · refreshes every 10 min</span> : null}>
        {d.history ? (
          <PriceChart data={d.history.map((p) => ({ ts: p.ts, price: p.price }))} height={240} />
        ) : (
          <div className="h-[240px] flex flex-col items-center justify-center text-center text-sm text-muted gap-2">
            <div>Price history unavailable right now.</div>
            <div className="text-xs">CoinGecko didn&apos;t answer; the chart returns on the next refresh.</div>
          </div>
        )}
      </Section>

      {/* I · Flywheel fuel (estimate) beside the last eight burns. */}
      <div className="grid md:grid-cols-3 gap-4">
        <Section title="Estimated STONK buybacks per day (USD)" className="md:col-span-2" action={<span className="num text-[11px] text-muted">daily · UTC · 5 min · <Link href="/flywheel" className="text-secondary hover:text-primary">Flywheel →</Link></span>}>
          <CountBarChart data={buybackSeries} height={220} name="Buybacks" fmt="usd" />
          <p className="text-xs text-muted mt-2.5">Daily fee revenue × lifetime buyback share ({(buybackShare * 100).toFixed(0)}%). An estimate; the ledger is in the burn list and on <Link href="/flywheel" className="text-secondary hover:text-primary">Flywheel</Link>.</p>
        </Section>
        <Section title="Recent STONK burns" className="flex flex-col" action={<span className="num text-[11px] text-muted">last {burns.length} · UTC · 60s</span>}>
          {burns.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>When</th><th className="r">STONK</th><th className="r">USD</th><th className="r">Tx</th></tr></thead>
                <tbody>
                  {burns.map((b) => (
                    <tr key={b.signature}>
                      <td className="text-secondary">{timeAgo(b.burnedAt, now)}</td>
                      <td className="r">{fmtNum(b.amountTokens, 1)}</td>
                      <td className="r">{fmtUsd(b.valueUsdAtBurn)}</td>
                      <td className="r"><ExplorerLink addr={b.signature} kind="tx" label={`${shortAddr(b.signature, 4)} ↗`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-muted">No burn events.</div>
          )}
          <Link href="/flywheel" className="num mt-auto pt-3 text-[11px] text-secondary hover:text-primary border-t border-border block">Full ledger · {fmtNum(d.burns?.burns.length ?? 0)} burns · live buyback feed →</Link>
        </Section>
      </div>

      {/* K · Pool + projection. */}
      <div className="grid md:grid-cols-3 gap-4">
        <Section title="Main pool · STONK / SPYx" action={d.pool ? <a href={`https://raydium.io/liquidity-pools/?token=${STONK_MINT}`} target="_blank" rel="noreferrer" className="num text-[11px] text-muted hover:text-primary">Raydium ↗</a> : null}>
          {d.pool && d.poolSides ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
              <dt className="text-muted">Type</dt><dd className="num text-right">Raydium {d.pool.type} · {(d.pool.feeRate * 100).toFixed(0)}% fee</dd>
              <dt className="text-muted">TVL</dt><dd className="num text-right">{fmtUsd(d.pool.tvl)}</dd>
              <dt className="text-muted">STONK side</dt><dd className="num text-right">{fmtNum(d.poolSides.stonkReserve)} STONK{d.poolSides.stonkSideUsd ? ` · ${fmtUsd(d.poolSides.stonkSideUsd)}` : ""}</dd>
              <dt className="text-muted">{d.poolSides.quote.symbol} side</dt><dd className="num text-right">{fmtNum(d.poolSides.quoteReserve, 2)} {d.poolSides.quote.symbol}{d.poolSides.quoteSideUsd ? ` · ${fmtUsd(d.poolSides.quoteSideUsd)}` : ""}</dd>
              <dt className="text-muted">Pool price</dt><dd className="num text-right">{fmtNum(d.pool.price)} STONK per {d.poolSides.quote.symbol}</dd>
              <dt className="text-muted">Pool volume 24h</dt><dd className="num text-right">{fmtUsd(d.pool.day?.volume)}</dd>
              <dt className="text-muted">Net flow 24h</dt>
              <dd className="num text-right">
                {d.flow ? (
                  <span className={d.flow.netStonkIntoPool <= 0 ? "text-up" : "text-down"}>
                    {fmtUsd(Math.abs(d.flow.netStonkUsd))} {d.flow.netStonkIntoPool <= 0 ? "net buying" : "net selling"}
                  </span>
                ) : (
                  <span className="text-muted">collecting</span>
                )}
              </dd>
            </dl>
          ) : (
            <div className="text-sm text-muted">Raydium didn&apos;t answer on this read; the pool returns on the next refresh.</div>
          )}
          <p className="num text-[11px] text-muted mt-3">Raydium · 60s · net flow from stonk.fyi pool snapshots · 5 min (falling STONK reserve = net buying)</p>
        </Section>
        <Section title="Flywheel projection" className="md:col-span-2" action={<span className="num text-[11px] text-muted">models one input · not a forecast</span>}>
          <Projection inputs={d.projection} />
        </Section>
      </div>

      {/* L · Ecosystem. */}
      <Section title="Tokens priced in STONK" action={<Link href={`/tokens?quoteMint=${STONK_MINT}&sort=volume`} className="num text-[11px] text-secondary hover:text-primary">All {fmtNum(d.quotedTotal)} →</Link>}>
        <p className="text-[12.5px] text-muted mb-2.5">Launches that chose STONK as their quote asset. Their fees are paid in STONK.</p>
        {d.quoted.length ? <TokenTable tokens={d.quoted.slice(0, 10)} now={now} compact /> : <div className="text-sm text-muted">None yet.</div>}
      </Section>

      <p className="num text-xs text-muted">
        Launched {fmtDate(t.createdAt)} · creator <ExplorerLink addr={t.creator ?? ""} label={shortAddr(t.creator)} /> · pool <ExplorerLink addr={t.pool ?? ""} label={shortAddr(t.pool)} /> ·{" "}
        <Link href={`/tokens/${STONK_MINT}`} className="text-secondary hover:text-primary">token detail →</Link>
      </p>
    </div>
  );
}
