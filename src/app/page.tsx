import Link from "next/link";
import { getStonkData } from "@/lib/stonk";
import { STONK_MINT } from "@/lib/api";
import { cumulative, fmtDate, fmtNum, fmtPrice, fmtUsd, nowMs, shortAddr, timeAgo } from "@/lib/format";
import { Delta, ExplorerLink, KpiTile, Section } from "@/components/ui";
import { BurnBarChart, CountBarChart, CumulativeChart, PriceChart } from "@/components/charts";
import Scorecard, { TallyBar } from "@/components/Scorecard";
import Foundation from "@/components/Foundation";
import { GMGN_TOKEN_URL } from "@/lib/gmgn";
import BuybackFeed from "@/components/BuybackFeed";
import TokenTable from "@/components/TokenTable";
import Projection from "@/components/Projection";

export const dynamic = "force-dynamic";

export default async function StonkPage() {
  const now = nowMs();
  const d = await getStonkData();
  const t = d.token;
  const m = t.market ?? {};
  const r = d.revenue;

  // Burn events bucketed by 10-minute window for the recent-burns chart.
  const buckets = new Map<string, number>();
  for (const b of d.burns?.burns ?? []) {
    const dt = new Date(b.burnedAt);
    dt.setUTCMinutes(Math.floor(dt.getUTCMinutes() / 10) * 10, 0, 0);
    const key = dt.toISOString().slice(11, 16);
    buckets.set(key, (buckets.get(key) ?? 0) + b.amountTokens);
  }
  const burnSeries = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));

  // Buyback dollars per day ≈ buyback share × daily revenue (the flywheel's fuel line).
  const buybackShare = r.revenue.totalRevenueUsd ? r.revenue.totalBuybackUsd / r.revenue.totalRevenueUsd : 0;
  const buybackSeries = d.days.map((x) => ({ date: x.date, value: x.dailyRevenue * buybackShare }));
  const cumBuyback = cumulative(d.days, (x) => x.dailyRevenue * buybackShare);

  const fromPeak = m.peakMarketCapUsd && m.marketCapUsd ? ((m.marketCapUsd - m.peakMarketCapUsd) / m.peakMarketCapUsd) * 100 : undefined;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-end pt-2">
        <div>
          <div className="label mb-2.5">Platform token · StonkFun launchpad · Solana</div>
          <h1 className="text-[40px] leading-none font-semibold tracking-tighter flex items-baseline gap-3.5 flex-wrap">
            $STONK <span className="num text-[13px] tracking-normal font-medium text-secondary">paired with SPYx</span>
          </h1>
          <p className="text-sm text-secondary mt-3 max-w-[62ch]">
            Fixed 1B supply, no mint authority, revenue-funded buybacks burned on-chain. Every figure below links to the API response or the Solscan transaction it came from.{" "}
            <span className="whitespace-nowrap"><ExplorerLink addr={STONK_MINT} kind="token" label={shortAddr(STONK_MINT, 6)} /></span>
          </p>
        </div>
        <div className="md:text-right">
          <div className="num text-[54px] leading-none font-medium tracking-tighter">{fmtPrice(m.priceUsd)}</div>
          <div className="num text-[13px] text-secondary mt-2">
            <Delta value={m.priceChange24h} /> 24h
            {fromPeak !== undefined && m.peakMarketCapUsd && (<> · <Delta value={fromPeak} /> from peak {fmtUsd(m.peakMarketCapUsd)} mcap</>)}
            {" "}· snapshot {timeAgo(d.generatedAt, now)}
          </div>
          {d.gmgn && d.gmgn.priceUsd > 0 && m.priceUsd && (
            <div className="num text-[12px] text-muted mt-1.5">
              <a href={GMGN_TOKEN_URL} target="_blank" rel="noreferrer" className="hover:text-accent">GMGN</a> {fmtPrice(d.gmgn.priceUsd)} ·{" "}
              <span className={Math.abs((d.gmgn.priceUsd / m.priceUsd - 1) * 100) > 3 ? "text-caution" : ""}>{((d.gmgn.priceUsd / m.priceUsd - 1) * 100).toFixed(1)}% vs StonkFun</span>
              {d.gmgn.biggestPool && <> · {d.gmgn.biggestPool.exchange} STONK/{d.gmgn.biggestPool.quoteSymbol}</>}
              {" "}· {fmtNum(d.gmgn.holderCount)} holders
            </div>
          )}
        </div>
      </div>

      <Foundation d={d} now={now} />

      <div>
        <TallyBar indicators={d.indicators} />
        <p className="text-xs text-muted mt-2">Only things that can objectively move both ways are scored. Each indicator is computed live and colored by its actual state; this tally can and will turn.</p>
      </div>

      <div className="kpis">
        <KpiTile label="Market cap" value={fmtUsd(m.marketCapUsd)} delta={fromPeak} sub="from peak" />
        <KpiTile label="24h volume" value={fmtUsd(m.volume24hUsd)} sub={m.marketCapUsd && m.volume24hUsd ? `${((m.volume24hUsd / m.marketCapUsd) * 100).toFixed(1)}% of market cap` : undefined} />
        {d.gmgn
          ? <KpiTile label="Holders" value={fmtNum(d.gmgn.holderCount)} sub={`${fmtNum(d.gmgn.wallets.smart)} smart money · ${fmtNum(d.gmgn.wallets.kol)} KOL · GMGN`} />
          : <KpiTile label="Circulating supply" value={fmtNum(d.supply.circulating)} sub={`${d.supply.burnedPct.toFixed(2)}% burned`} />}
        <KpiTile label="Peak market cap" value={fmtUsd(m.peakMarketCapUsd)} sub={fromPeak !== undefined ? `${fromPeak.toFixed(1)}% from peak now` : undefined} />
      </div>

      {/* Scorecard */}
      <Scorecard indicators={d.indicators} watch={d.watch} />

      {/* Price + burns */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Price (USD)" className="lg:col-span-3" action={d.history ? <span className="num text-xs text-muted">CoinGecko · 90d · stonk-3</span> : null}>
          {d.history ? (
            <PriceChart data={d.history.map((p) => ({ ts: p.ts, price: p.price }))} />
          ) : (
            <div className="h-[280px] flex flex-col items-center justify-center text-center text-sm text-muted gap-2">
              <div>Price history not available from this data source yet.</div>
              <div className="text-xs">Live deployments pull 90 days from CoinGecko; the snapshot worker records intra-day prices into Postgres for finer charts.</div>
            </div>
          )}
        </Section>
      </div>

      {/* Flywheel fuel */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Estimated STONK buybacks per day (USD)" className="lg:col-span-2" action={<Link href="/flywheel" className="text-xs text-muted hover:text-primary">Flywheel →</Link>}>
          <CountBarChart data={buybackSeries} height={240} name="Buybacks" fmt="usd" />
          <div className="text-xs text-muted mt-2">Platform fee revenue × lifetime buyback share ({(buybackShare * 100).toFixed(0)}%). Actual buybacks execute every few minutes; the snapshot worker records each one.</div>
        </Section>
        <Section title="Cumulative buyback spend">
          <CumulativeChart data={cumBuyback} height={240} name="Cumulative buybacks" />
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Recent STONK burns" action={<span className="text-xs text-muted">last {d.burns?.burns.length ?? 0} events · UTC</span>}>
          {burnSeries.length ? <BurnBarChart data={burnSeries} /> : <div className="text-sm text-muted">No burn events.</div>}
          <div className="table-wrap mt-3 max-h-64 overflow-y-auto">
            <table className="data">
              <thead><tr><th>When</th><th className="r">STONK</th><th className="r">USD</th><th>Source</th><th>Tx</th></tr></thead>
              <tbody>
                {(d.burns?.burns ?? []).slice(0, 15).map((b) => (
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
        </Section>
        <Section title="Live buyback feed" action={<span className="text-xs text-muted num">last {timeAgo(r.revenue.lastBuybackAt, now)}</span>}>
          <BuybackFeed buybacks={r.recentBuybacks} now={now} limit={12} />
        </Section>
      </div>

      {/* Pool + projection */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Main pool · STONK / SPYx" action={d.pool ? <a href={`https://raydium.io/liquidity-pools/?token=${STONK_MINT}`} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-primary">Raydium ↗</a> : null}>
          {d.pool && d.poolSides ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted">Type</dt><dd className="text-right">Raydium {d.pool.type} · {(d.pool.feeRate * 100).toFixed(0)}% fee</dd>
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
                  <span className="text-muted">collecting (needs snapshot worker)</span>
                )}
              </dd>
            </dl>
          ) : (
            <div className="text-sm text-muted">Raydium pool info unavailable.</div>
          )}
          <div className="text-xs text-muted mt-3">Reserves from Raydium&apos;s pool API. The worker snapshots them every 5 minutes; the change in the STONK reserve is the net flow. A falling reserve means STONK is leaving the pool, which is net buying.</div>
        </Section>
        <Section title="Flywheel projection" className="lg:col-span-2">
          <Projection inputs={d.projection} />
        </Section>
      </div>

      {/* Ecosystem */}
      <Section title="Tokens priced in STONK" action={<Link href={`/tokens?quoteMint=${STONK_MINT}&sort=volume`} className="text-xs text-muted hover:text-primary">All {fmtNum(d.quotedTotal)} →</Link>}>
        <div className="text-xs text-muted mb-3">
          Launches that chose STONK as their quote asset. Every trade in these pools is denominated in STONK, and their fees flow back into the buyback engine.
        </div>
        {d.quoted.length ? <TokenTable tokens={d.quoted.slice(0, 10)} now={now} /> : <div className="text-sm text-muted">None yet.</div>}
      </Section>

      <div className="text-xs text-muted">
        Launched {fmtDate(t.createdAt)} · creator <ExplorerLink addr={t.creator ?? ""} label={shortAddr(t.creator)} /> · pool <ExplorerLink addr={t.pool ?? ""} label={shortAddr(t.pool)} /> ·{" "}
        <Link href={`/tokens/${STONK_MINT}`} className="hover:text-primary">token detail →</Link>
      </div>
    </div>
  );
}
