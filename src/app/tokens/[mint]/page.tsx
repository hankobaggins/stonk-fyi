import Link from "next/link";
import { notFound } from "next/navigation";
import { getToken, getTokenBacking, getTokenBurns, getTokenFees, getTokenRewards, resolveImage } from "@/lib/api";
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd, nowMs, timeAgo } from "@/lib/format";
import { Delta, ExplorerLink, KpiTile, ModePill, Section, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/tokens/[mint]">) {
  const { mint } = await params;
  const t = await getToken(mint);
  return { title: t ? `${t.data.token.symbol} / ${t.data.token.quote.symbol}` : "Token" };
}

function JsonBlock({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <Section title={title}>
      <pre className="text-xs font-mono text-secondary overflow-x-auto whitespace-pre">{JSON.stringify(data, null, 2)}</pre>
    </Section>
  );
}

export default async function TokenPage({ params }: PageProps<"/tokens/[mint]">) {
  const { mint } = await params;
  const res = await getToken(mint);
  if (!res) notFound();
  const t = res.data.token;
  const launch = res.data.launch;
  const m = t.market ?? {};
  const now = nowMs();
  const [burns, rewards, fees, backing] = await Promise.all([getTokenBurns(mint), getTokenRewards(mint), getTokenFees(mint), getTokenBacking(mint)]);
  const img = resolveImage(t.imageUrl);
  const drawdown = m.peakMarketCapUsd && m.marketCapUsd ? ((m.marketCapUsd - m.peakMarketCapUsd) / m.peakMarketCapUsd) * 100 : undefined;
  const timeToGraduate = t.graduatedAt ? (Date.parse(t.graduatedAt) - Date.parse(t.createdAt)) / 60000 : undefined;

  return (
    <div className="space-y-5">
      <div className="text-xs text-muted">
        <Link href="/tokens" className="hover:text-primary">Tokens</Link> / {t.symbol}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="w-14 h-14 rounded-full bg-surface-2 object-cover" />
        ) : (
          <span className="w-14 h-14 rounded-full bg-surface-2 inline-block" />
        )}
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
          <a href={`https://www.stonkfun.xyz/token/${t.mint}`} target="_blank" rel="noreferrer" className="text-secondary hover:text-accent">Open on StonkFun ↗</a>
          {t.links?.twitter && <a href={t.links.twitter} target="_blank" rel="noreferrer" className="text-secondary hover:text-accent">Twitter ↗</a>}
          {t.links?.website && <a href={t.links.website} target="_blank" rel="noreferrer" className="text-secondary hover:text-accent">Website ↗</a>}
        </div>
      </div>

      <div className="kpis">
        <KpiTile label="Price" value={fmtPrice(m.priceUsd)} delta={m.priceChange24h} sub="24h" />
        <KpiTile label="Market cap" value={fmtUsd(m.marketCapUsd)} sub={`peak ${fmtUsd(m.peakMarketCapUsd)}`} />
        <KpiTile label="24h volume" value={fmtUsd(m.volume24hUsd)} sub={m.marketCapUsd && m.volume24hUsd ? `${(m.volume24hUsd / m.marketCapUsd).toFixed(2)}× market cap` : undefined} />
        <KpiTile label="From peak" value={<Delta value={drawdown} />} sub={m.liquidityUsd ? `liquidity ${fmtUsd(m.liquidityUsd)}` : undefined} />
      </div>

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
        <JsonBlock title="Burns (platform fee sweeps)" data={burns ? { totals: burns.totals, recent: burns.burns.slice(0, 10) } : null} />
        <JsonBlock title="Holder rewards" data={rewards} />
        <JsonBlock title="Creator claimable fees" data={fees} />
        <JsonBlock title="Backing value" data={backing} />
      </div>

      <Section title="Price history">
        <div className="text-sm text-muted">
          The StonkFun API only exposes current market values. Historical price, market cap and volume charts appear here once the snapshot
          worker (see <code className="font-mono">supabase/</code> and <code className="font-mono">/api/cron/snapshot</code>) has been running against a database.
        </div>
      </Section>
    </div>
  );
}
