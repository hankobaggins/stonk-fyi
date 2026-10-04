import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveImage } from "@/lib/api";
import { getQuoteAssetDetail } from "@/lib/quote-assets";
import { buildChecks, CHURN_TURNOVER, isStockCategory, ORACLE_LABEL, usMarketOpen} from "@/lib/quote-math";
import IssuerGroupTable from "@/components/IssuerGroupTable";
import { fmtNum, fmtPct, fmtPrice, fmtUsd, nowMs } from "@/lib/format";
import { Delta, ExplorerLink, KpiTile, ModePill, Section } from "@/components/ui";
import TokenIcon from "@/components/TokenIcon";
import CopyAddress from "@/components/CopyAddress";
import { TradeLink } from "@/components/BuyButton";
import { OG_VERSION_MS, SITE_URL } from "@/lib/site";
import { getCommunityQuote } from "@/lib/community";
import ShareCard from "@/components/ShareCard";

export const dynamic = "force-dynamic";

const cardPath = (mint: string, now: number) => `/pairs/${mint}/card?v=${Math.floor(now / OG_VERSION_MS)}`;

export async function generateMetadata({ params }: PageProps<"/pairs/[mint]">) {
  const { mint } = await params;
  const d = await getQuoteAssetDetail(mint).catch(() => null);
  if (!d) return { title: "Quote asset" };
  const sym = d.row.jupSymbol ?? d.pair.symbol;
  const title = `${fmtNum(d.coinsTotal)} ${d.coinsTotal === 1 ? "coin is" : "coins are"} priced in ${sym}`;
  const img = cardPath(mint, nowMs());
  return {
    title: `${sym} as a quote asset`,
    description: `${title}: the ${d.row.categoryLabel} token's own liquidity, holders, venues and reference price, and the StonkFun coins that use it as their unit of account.`,
    openGraph: { title, images: [{ url: img, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [img] },
  };
}

export default async function QuoteAssetPage({ params }: PageProps<"/pairs/[mint]">) {
  const { mint } = await params;
  const [d, cm] = await Promise.all([getQuoteAssetDetail(mint), getCommunityQuote(mint, 5).catch(() => null)]);
  if (!d) notFound();
  const { row, pair, jup, venues, coins, group } = d;
  const now = nowMs();
  const sym = row.jupSymbol ?? pair.symbol;
  const stock = isStockCategory(row.category);
  const open = usMarketOpen(now);
  const checks = buildChecks({
    symbol: sym,
    ticker: row.ticker,
    issuerLabel: row.categoryLabel,
    verified: jup?.verified ?? null,
    liquidityUsd: row.liquidityUsd,
    holders: row.holders,
    venues: venues?.venues ?? null,
    oracle: stock ? row.oracle : null,
    mintAuthority: jup?.mintAuthority ?? null,
    freezeAuthority: jup?.freezeAuthority ?? null,
    marketOpen: open,
  });
  const platform = coins.find((c) => c.platform);
  const churners = coins.filter((c) => c.turnover != null && c.turnover > CHURN_TURNOVER).length;
  const card = cardPath(mint, now);

  return (
    <div className="space-y-5">
      <nav className="num text-xs text-muted flex gap-2" aria-label="Breadcrumb">
        <Link href="/pairs" className="text-secondary hover:text-primary">Pairs</Link><span>/</span><span className="text-primary">{sym}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-4 border-b border-border">
        <div className="flex items-center gap-4 min-w-0">
          <TokenIcon src={jup?.icon ?? resolveImage(pair.logoUrl)} symbol={sym} size={56} className="hidden sm:block" />
          <div className="flex flex-col gap-2 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {fmtNum(d.coinsTotal)} StonkFun coin{d.coinsTotal === 1 ? " is" : "s are"} priced in {sym}
            </h1>
            <p className="text-[13px] text-muted max-w-[80ch]">
              {jup?.name ?? row.name} · {row.categoryLabel}. What the asset itself looks like as a market, then the coins using it as their unit of account.
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="pill">{row.categoryLabel}</span>
              {stock && row.oracle && <span className={`state ${row.oracle.state === "247" || row.oracle.state === "crypto" ? "bull" : row.oracle.state === "proxy" ? "neutral" : "bear"}`}>{row.oracle.state === "crypto" ? "crypto" : `${ORACLE_LABEL[row.oracle.state]} oracle`}</span>}
              <CopyAddress value={mint} label={`${mint.slice(0, 4)}…${mint.slice(-4)}`} />
              <ExplorerLink addr={mint} kind="token" label="Solscan ↗" />
              <Link href={`/tokens?quoteMint=${mint}&sort=volume`} className="num text-xs text-secondary hover:text-accent">All coins in /tokens →</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="kpis">
        <KpiTile label="Price" value={fmtPrice(row.priceUsd)} delta={jup?.priceChange24h ?? null} sub={<span className="text-muted">Jupiter · 5 min</span>} />
        <KpiTile label="Liquidity" value={fmtUsd(row.liquidityUsd)} sub={<span className="text-muted">every pool it trades in · Jupiter</span>} />
        <KpiTile label="Own 24h volume" value={fmtUsd(row.volume24hUsd)} sub={<span className="text-muted">the asset itself, all pairs · Jupiter</span>} />
        <KpiTile label="Coins' 24h volume" value={fmtUsd(d.shownVolume)} sub={<span className="text-muted">top {coins.length} StonkFun coins in it · 30s</span>} />
      </div>

      <Section title={`Is ${sym} what it says it is?`} action={<span className="src">Jupiter · DexScreener · Pyth feed list · 5 min–6 h</span>}>
        <p className="text-[13px] text-secondary mb-3 max-w-[80ch]">Checks on the quote asset itself, before anything priced in it. Arithmetic on public data, not a verdict.</p>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {checks.map((c) => (
            <div key={c.key} className={`ind ${c.state}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="label">{c.label}</span>
                <span className="num text-[15px] font-medium text-right">{c.value}</span>
              </div>
              <p className="text-xs text-secondary mt-2 leading-relaxed">{c.detail}</p>
            </div>
          ))}
        </div>
        <p className="num text-[11px] text-muted mt-3">
          Thresholds: liquidity $1M / $100K, holders 10K / 1K, venues 3 / 2 DEXes with ≥ $1K. <Link href="/about#quote-assets" className="text-secondary hover:text-primary">Method →</Link>
        </p>
      </Section>

      {group && (
        <Section title={`The same asset from another issuer: ${group.key}`} action={<span className="src">Jupiter prices · 5 min</span>}>
          <p className="text-[13px] text-secondary mb-3 max-w-[80ch]">
            {group.spreadPct != null ? <>StonkFun lists {group.members.length} tokens for {group.key}, priced <span className="num text-primary">{fmtPct(group.spreadPct).replace("+", "")}</span> apart. </> : null}
            {group.anyPublicFeed ? "A public share price exists, so a wide gap is either denomination or a mispricing someone can arbitrage." : "The company is private: no published share price exists to say which figure is right. Part of the gap may be denomination — each issuer's token can represent a different slice of a share — and a buyer cannot check which."}
          </p>
          <IssuerGroupTable group={group} current={mint} />
        </Section>
      )}

      <Section title={`What is priced in ${sym}`} action={<span className="src">StonkFun market data · 30s · liquidity Jupiter · 5 min</span>}>
        <p className="text-[13px] text-secondary mb-3 max-w-[80ch]">
          The {coins.length} most traded of {fmtNum(d.coinsTotal)} coins quoted in {sym}. Turnover is 24h volume ÷ liquidity across every pool the coin is in; far above {CHURN_TURNOVER}× is churning faster than organic demand usually does{churners > 0 ? <> (<span className="num text-caution">{churners}</span> here)</> : null}. The address identifies the coin; it says nothing about whether it is any good.
        </p>
        {platform && (
          <p className="text-xs text-secondary border-l-2 border-accent pl-3 mb-3 max-w-[80ch]">
            STONK is the StonkFun launchpad&apos;s own token, not an independent coin. Its volume is real but reflects the platform&apos;s activity, and it is counted in the {fmtUsd(d.shownVolume)} above; read that figure with this in mind.
          </p>
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="st1">#</th>
                <th className="st2">Coin</th>
                <th className="p3">Address</th>
                <th className="p3">Mode</th>
                <th className="r">Market cap</th>
                <th className="r">24h volume</th>
                <th className="r">Liquidity</th>
                <th className="r">Turnover</th>
                <th className="r">24h</th>
                <th className="r p3">Holders</th>
                <th className="r">Trade</th>
              </tr>
            </thead>
            <tbody>
              {coins.map((c, i) => (
                <tr key={c.mint}>
                  <td className="st1 num text-muted">{i + 1}</td>
                  <td className="st2">
                    <Link href={c.platform ? "/" : `/tokens/${c.mint}`} className="font-medium hover:text-accent">{c.symbol}</Link>
                    {c.platform ? <span className="pill accent ml-2">platform</span> : <span className="text-muted text-xs ml-2 hidden sm:inline">{c.name}</span>}
                  </td>
                  <td className="p3"><CopyAddress value={c.mint} /></td>
                  <td className="p3"><ModePill mode={c.mode} cm={c.communityMode?.shareBps} /></td>
                  <td className="r num">{fmtUsd(c.marketCapUsd)}</td>
                  <td className="r num">{fmtUsd(c.volume24hUsd)}</td>
                  <td className="r num">{fmtUsd(c.liquidityUsd)}</td>
                  <td className={`r num ${c.turnover != null && c.turnover > CHURN_TURNOVER ? "text-caution" : ""}`}>{c.turnover == null ? "—" : `${c.turnover.toFixed(1)}×`}</td>
                  <td className="r"><Delta value={c.priceChange24h} /></td>
                  <td className="r num p3">{fmtNum(c.holders)}</td>
                  <td className="r"><TradeLink mint={c.mint} /></td>
                </tr>
              ))}
              {coins.length === 0 && (
                <tr><td colSpan={11} className="text-center text-muted py-6">No StonkFun coin is quoted in {sym} right now.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {cm && (
        <Section title={`Community Mode: sent to ${sym} holders`} action={<span className="src">stonk.fyi split of StonkFun payouts · 15 min</span>}>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] gap-5 items-start">
            <div className="space-y-4">
              <div className="kpis !border-b-0 !pb-0">
                <KpiTile label={`Sent to ${sym} holders`} value={<span className="text-[var(--series-2)]">{cm.row.toQuoteUsd !== null ? fmtUsd(cm.row.toQuoteUsd) : "unpriced"}</span>} sub={`${fmtNum(cm.row.toQuoteTokens, cm.row.toQuoteTokens < 100 ? 2 : 0)} ${sym} · today's price`} />
                <KpiTile label="Community coins" value={fmtNum(cm.row.coins)} sub={`${fmtNum(cm.row.active)} in the mode now · ${fmtNum(cm.row.graduated)} graduated`} />
              </div>
              <p className="text-[13px] text-secondary max-w-[70ch]">StonkFun coins launched in Community Mode against {sym} send 33% of every holder payout to wallets holding {sym}, pushed to them with nothing to claim. Top senders: {cm.coins.slice(0, 3).map((c, i) => <span key={c.mint}>{i ? ", " : ""}<Link href={`/tokens/${c.mint}`} className="text-primary hover:underline">{c.symbol ?? c.mint.slice(0, 4)}</Link>{c.toQuoteUsd !== null ? ` (${fmtUsd(c.toQuoteUsd)})` : ""}</span>)}.</p>
              <Link href="/rewards?mode=community" className="num text-xs text-secondary hover:text-primary">Every quote token → Holder rewards · Community mode</Link>
            </div>
            <ShareCard src={`/community-card/${mint}?v=${Math.floor(now / 300_000)}`} name={`stonk-community-${sym.replace(/[^A-Za-z0-9]/g, "")}.png`} alt={`Community Mode: sent to ${sym} holders`} />
          </div>
        </Section>
      )}

      <Section title="Share this" action={<span className="src">rendered live · URL changes every 5 min</span>}>
        <div className="grid lg:grid-cols-[minmax(0,560px)_1fr] gap-4 items-start">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own card route, not a creator-hosted token image */}
          <img src={card} alt={`Share card: coins priced in ${sym}`} width={1200} height={630} className="w-full h-auto rounded border border-border" loading="lazy" />
          <div className="text-[13px] text-secondary space-y-3">
            <p>Post this page&apos;s link anywhere and the card unfurls with it. It renders when someone opens the link, so the figures are current then, not when you posted.</p>
            <div className="flex flex-wrap gap-3 items-center">
              <CopyAddress value={`${SITE_URL}/pairs/${mint}`} label="Copy link" />
              <a href={`/pairs/${mint}/card`} className="num text-xs text-secondary hover:text-accent" target="_blank" rel="noreferrer">Open card PNG ↗</a>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
