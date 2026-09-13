import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { STONK_MINT } from "@/lib/api";
import { STONK_LAUNCHED_AT, STONK_POOL } from "@/lib/stonk";
import { ExplorerLink, PageHeader, Section } from "@/components/ui";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Methodology & data sources",
  description: "How stonk.fyi computes every number: data sources, the bull-case scorecard thresholds, the projection model, and what the site does not know.",
  alternates: { canonical: "/about" },
};

const INDICATORS: { group: string; rows: [string, string, string][] }[] = [
  {
    group: "Flywheel",
    rows: [
      ["Burn rate", "tokens burned per hour over the most recent burn window, as % of supply per day", "> 0.3% / day"],
      ["Buyback pressure", "7-day revenue × lifetime buyback share (total buybacks ÷ total revenue) ÷ 7", "> $10K / day"],
      ["Buybacks / 24h volume", "estimated daily buybacks ÷ STONK 24h volume", "> 1%"],
      ["Revenue growth", "last 7 days of platform revenue vs the 7 days before", "> +20%"],
      ["Price vs avg buyback", "price ÷ (total USD spent on buybacks ÷ tokens bought back)", "> 1×"],
    ],
  },
  {
    group: "Demand",
    rows: [
      ["STONK-quoted volume", "24h volume through pools whose quote asset is STONK (the count of such pools only rises, so it is not scored)", "> $1M (neutral > $100K)"],
      ["Pool depth", "Raydium TVL of the main STONK/SPYx pool", "> $5M (neutral above $500K)"],
      ["Net flow", "change in the pool's STONK reserve over 24h; a falling reserve means net buying", "net buying"],
      ["Turnover", "24h volume ÷ market cap", "2% – 100%"],
      ["Price change, 24h", "StonkFun's reported 24h change in USD price (includes SPYx's move)", "> 0"],
    ],
  },
  {
    group: "Holders & flow (HolderScan, GMGN)",
    rows: [
      ["Holders", "HolderScan's count of wallets with any STONK balance, scored on HolderScan's own 24h change (GMGN's count, scored after 12h of this site's snapshots, when HolderScan is unavailable)", "> +0.5% / 24h (neutral ±0.5%)"],
      ["Holders over $1K", "wallets holding more than $1,000 of STONK at HolderScan's valuation; scored on the 24h change between this site's readings (after ~19h of them)", "> +0.5% / 24h (neutral ±0.5%)"],
      ["Diamond hands, top 1000", "share of the 1,000 largest wallets' STONK that sits in HolderScan's longest-held class (FIFO). Initial thresholds, set 2026-09-12", "≥ 50% (neutral ≥ 25%)"],
      ["Price vs holders' break-even", "price ÷ HolderScan's aggregate break-even price of the holder base", "context only, not scored"],
      ["Top-10 concentration", "share of supply in the ten largest wallets, pools included", "< 20% (neutral below 35%)"],
      ["Buy share of volume", "24h buy volume ÷ (buy + sell volume) across every pool STONK trades in", "> 52% (neutral 48–52%)"],
      ["Smart-money holders", "wallets GMGN tags as smart money currently holding STONK", "≥ 100 (neutral ≥ 25)"],
    ],
  },
  { group: "Platform", rows: [["Launchpad volume", "launchpad-wide 24h trading volume (token count only rises, so it is not scored)", "> $10M (neutral > $1M)"]] },
  {
    group: "Valuation",
    rows: [
      ["Launch multiple", "market cap ÷ market cap at launch", "context only, not scored"],
      ["Price-to-sales", "market cap ÷ (7-day revenue × 52)", "< 10×"],
    ],
  },
];

const CADENCE: [string, string, string][] = [
  ["Page render", "server components, re-fetched by the browser", "60s"],
  ["Buyback / burn toasts", "StonkFun buyback ledger", "20s"],
  ["Price, market cap, volume, token list, revenue, stats", "StonkFun API", "30s"],
  ["Burn ledger, rewards, creator fees", "StonkFun API", "60s"],
  ["Main pool reserves and TVL", "Raydium", "60s"],
  ["Concentration, buy/sell volume, wallet tags", "GMGN", "60s"],
  ["$STONK holder base: holders and HolderScan's own 1h–30d changes, holders by value and size tier, median position, hold time, retention, hold-time classes of the top 1000, top-10 / top-100 share, break-even and PnL", "stonk.fyi readings of HolderScan's profile routes, stored in Postgres; the page never calls HolderScan", "every tick on the Advanced plan (5 min), every 6 h on Standard"],
  ["Revenue history (daily)", "StonkFun API", "5 min"],
  ["Net flow, holder growth, token history", "stonk.fyi snapshots in Postgres: STONK, the main pool and the top 100 tokens every 5 min; top 500 hourly; all tokens daily", "5 min"],
  ["Quote-asset USD prices for holder rewards", "Jupiter price API", "5 min"],
  ["Holders across the ecosystem (every quote asset)", "stonk.fyi readings: HolderScan holder count per quote asset (hourly on the Advanced plan, daily on Standard); Helius on-chain census of wallets holding a reward coin", "hourly / daily"],
  ["On-chain wallet counts per quote asset; wallets holding a stock token", "stonk.fyi census of token accounts via Helius, every quote asset in the universe (stock assets on the free Helius plan)", "every 6 h"],
  ["Holder-fee APR (24h / 3d)", "stonk.fyi readings of each reward coin's lifetime payouts, every 5 min for coins that paid in the last 7 days", "5 min"],
  ["90-day price chart", "CoinGecko", "10 min"],
  ["Social card (link preview)", "rendered live; its URL changes every 5 min so link scrapers, which cache by URL, fetch a new render", "5 min"],
];

const TOC: [string, string][] = [
  ["what", "What this is"],
  ["token", "The token"],
  ["sources", "Data sources"],
  ["fresh", "How fresh is this?"],
  ["scored", "What is scored"],
  ["projection", "The projection"],
  ["yield", "Holder-fee APR"],
  ["holderbase", "The $STONK holder base"],
  ["holders", "Holders across the ecosystem"],
  ["unknown", "What this site does not know"],
];

const SOURCES: [string, string][] = [
  ["StonkFun API", "Platform stats, revenue and buyback history, token list and market data, burn ledger, launches, pairs, rewards. The ledger of record and the source of every USD figure on the site; its pricing feed is not independently verified here. Burn amounts and transaction signatures are on-chain and link to Solscan."],
  ["Raydium", "Reserves, TVL and 24h volume of the main STONK/SPYx pool. Used for pool depth, net flow, and the projection's quote-side depth."],
  ["HolderScan", "$STONK's holder profile — holder count with HolderScan's own 1h to 30d changes, holders by value held and by size tier, the median position, hold time and retention, the hold-time class of the 1,000 largest wallets, aggregate break-even and PnL — and the holder count of every quote asset on the Holders page. Read by this site's worker and stored; pages show the stored readings."],
  ["GMGN", "Top-10 concentration, wallet tags (smart money, KOL, whales), buy and sell volume across every pool STONK trades in, contract and LP checks, and an independent USD price from STONK's largest pool by liquidity. Optional; its cells read \"provider down\" when it is unavailable."],
  ["Jupiter", "Current USD prices for the ~250 quote assets reward coins pay in. Used on the Rewards page and on each reward coin's token page to value payouts, which StonkFun reports in native units."],
  ["CoinGecko", "90-day USD price history for the price chart. Best-effort; the chart shows a placeholder when it is unavailable."],
];

// Long-form reading page (redesign 2026-09-13): a sticky "On this page" column at ≥ lg, a chip row above the
// article below it; every section has an anchor that clears the sticky chrome.
export default function AboutPage() {
  return (
    <div className="grid lg:grid-cols-[200px_minmax(0,48rem)] gap-x-10 gap-y-5 lg:justify-center">
      <nav className="lg:sticky lg:top-[112px] lg:self-start flex flex-wrap lg:flex-col gap-1.5 lg:gap-0.5 text-[12.5px] lg:pt-1" aria-label="On this page">
        <div className="label basis-full lg:basis-auto lg:mb-2">On this page</div>
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="px-2.5 py-1.5 lg:py-1 rounded border border-border lg:border-0 lg:border-l-2 lg:rounded-none text-secondary hover:text-primary lg:hover:border-l-border-strong whitespace-nowrap">{label}</a>
        ))}
      </nav>
      <article className="space-y-4">
      <PageHeader title="Methodology & data sources" sub="What is measured, where it comes from, how fresh it is, and what this site does not know." />

      <Section title="What this is" id="what">
        <div className="text-sm text-secondary space-y-3 leading-relaxed">
          <p>
            {SITE_NAME} tracks <span className="text-primary">$STONK</span>, the platform token of the StonkFun launchpad on Solana. Every metric is
            computed from live data each time the page loads, and every scorecard indicator is colored by its actual state: bullish, neutral, or
            caution. The site is built to show the bear case as readily as the bull case; a page that can only show green is not worth reading.
          </p>
          <p>
            This is an <span className="text-primary">unofficial, independent dashboard</span>. It is not affiliated with, endorsed by, or maintained by
            StonkFun. Nothing here is financial advice.
          </p>
        </div>
      </Section>

      <Section title="The token" id="token">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs [&_dd]:break-words [&_dd]:min-w-0 [&_a]:break-all">
          <dt className="text-muted">Mint</dt><dd><ExplorerLink addr={STONK_MINT} kind="token" /></dd>
          <dt className="text-muted">Main pool</dt><dd><ExplorerLink addr={STONK_POOL} /> <span className="text-muted">Raydium CLMM, STONK / SPYx, 1% fee</span></dd>
          <dt className="text-muted">Launched</dt><dd className="num">{new Date(STONK_LAUNCHED_AT).toUTCString()}, graduated 16 minutes later</dd>
          <dt className="text-muted">Supply</dt><dd>1,000,000,000 fixed. Mint and freeze authority are null, so supply can only fall. Circulating = initial − burned.</dd>
        </dl>
      </Section>

      <Section title="Data sources" id="sources">
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[13px] text-secondary leading-relaxed">
          {SOURCES.map(([name, text]) => (<Fragment key={name}><dt className="num text-primary text-[12.5px] whitespace-nowrap">{name}</dt><dd>{text}</dd></Fragment>))}
        </dl>
      </Section>

      <Section title="How fresh is this?" id="fresh">
        <p className="text-sm text-secondary leading-relaxed mb-3">
          Every page re-renders itself every <span className="num text-primary">60 seconds</span> (the &quot;updated Ns ago&quot; counter in the nav). Each
          figure&apos;s source line shows how long the site caches that upstream, so a number can be up to that much older than the counter. StonkFun&apos;s own
          API is itself a snapshot, usually 20–30 seconds behind the chain; its timestamp is shown next to the price.
        </p>
        <div className="table-wrap">
          <table className="data min-w-[520px]">
            <thead><tr><th>What</th><th>Source</th><th className="r">Refreshes</th></tr></thead>
            <tbody>
              {CADENCE.map(([what, src, every]) => (
                <tr key={what}>
                  <td className="font-sans text-primary !whitespace-normal">{what}</td>
                  <td className="text-secondary !whitespace-normal">{src}</td>
                  <td className="r num">{every}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="What is scored, and what is not" id="scored">
        <div className="text-sm text-secondary space-y-3 leading-relaxed mb-4">
          <p>
            Only quantities that can objectively move both ways are scored. Facts that can only move in one direction are shown in the
            &quot;Structural&quot; block at the top of the $STONK page and never colored: the share of supply burned (it can only rise), the fixed
            1B supply, renounced mint and freeze authority, burned liquidity, and the absence of a transfer tax. A signal that cannot turn is
            not a signal; it is the floor the scorecard sits on.
          </p>
          <p>
            Where a headline number only rises (tokens ever launched, pools ever quoted in STONK, cumulative burns), the scorecard scores the
            flow behind it instead (24h volume, burn pace), so every colored cell can go amber.
          </p>
        </div>
        <p className="text-xs text-muted mb-3 leading-relaxed">
          Thresholds are judgment calls made on roughly six weeks of data since launch. They are deliberately simple and will be revisited as history
          accumulates; changes will be noted here.
        </p>
        <div className="table-wrap">
          <table className="data min-w-[600px]">
            <thead><tr><th>Indicator</th><th>Computed as</th><th>Bullish when</th></tr></thead>
            <tbody>
              {INDICATORS.map((g) => (
                <Fragment key={g.group}>
                  <tr className="bg-surface-2/60"><td colSpan={3} className="font-sans text-primary font-semibold !py-2">{g.group}</td></tr>
                  {g.rows.map(([label, how, when]) => (
                    <tr key={label}>
                      <td className="font-sans text-primary">{label}</td>
                      <td className="!whitespace-normal text-secondary">{how}</td>
                      <td className="text-secondary">{when}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="The projection" id="projection">
        <div className="text-sm text-secondary space-y-3 leading-relaxed">
          <p>
            The flywheel projection on the $STONK page models one thing: what revenue-funded buybacks alone do to price over a horizon. It brackets
            the answer with two models. The <span className="text-primary">floor</span> holds market cap constant and lets price rise only because burned
            tokens leave the supply. The <span className="text-primary">ceiling</span> treats every buyback dollar as a net buy that nobody sells into,
            pushed through a constant-product curve with the live quote-side depth.
          </p>
          <p>
            The ceiling is a deliberate over-estimate: a concentrated-liquidity pool has less slippage near the current price than constant-product
            assumes, and the other ~99% of order flow (everyone else buying and selling) is not modeled at all. Read it as a sensitivity tool, not a
            forecast.
          </p>
        </div>
      </Section>

      <Section title="Holder-fee APR" id="yield">
        <div className="text-sm text-secondary space-y-2 leading-relaxed">
          <p>The <Link href="/tokens" className="underline underline-offset-2 hover:text-primary">Tokens page</Link> shows a realized APR beside every tracked reward-mode coin (<Link href="/tokens?mode=reward&by=apr3" className="underline underline-offset-2 hover:text-primary">sort the reward coins by it</Link>): tokens paid to holders over a window (from this site&apos;s 5-minute readings of StonkFun&apos;s lifetime payout figure per coin) × the quote asset&apos;s USD price now, divided by the coin&apos;s market cap now, annualized by the hours the window actually covers. The 24h column uses the last day of payouts; the 3d column averages over 72 hours. A window is shown once readings cover at least 80% of it, and coins need 72 hours of trading history to be listed.</p>
          <p>It is deliberately not volume × fee rate. Volume-based estimates depend on assumptions about eligible balances, operating fees and which pools count; payouts are what happened. The trade-off is lag: a coin that started paying an hour ago shows nothing until its window fills. Market cap as the denominator understates a holder&apos;s own yield, since pool and program balances are not paid.</p>
        </div>
      </Section>

      <Section title="The $STONK holder base" id="holderbase">
        <div className="text-sm text-secondary space-y-2 leading-relaxed">
          <p>The Holder base block on the $STONK page and the four HolderScan cells in the scorecard come from HolderScan&apos;s profile of the mint, read by this site&apos;s worker (every tick on HolderScan&apos;s Advanced plan, every six hours on Standard) and stored, so the page shows a reading and its age rather than calling HolderScan on every visit. <span className="text-primary">Holders</span> is every wallet with a STONK balance on any venue; the 1h, 24h, 7d and 30d changes are HolderScan&apos;s own. <span className="text-primary">Average per holder</span> is StonkFun&apos;s market cap divided by that count — the stake each wallet would hold if every holder held the same; since a few large wallets and the pools pull it up, the <span className="text-primary">median position</span> (HolderScan&apos;s, in STONK, valued at StonkFun&apos;s price) is the typical holder. <span className="text-primary">Holders over $10 … $1M</span> and the shrimp-to-whale tiers are HolderScan&apos;s at its valuation at read time; their 24h changes are between this site&apos;s readings. <span className="text-primary">Hold-time classes</span> (diamond, gold, silver, bronze, wood, new) and the supply held by each cover the 1,000 largest wallets, FIFO. <span className="text-primary">Break-even</span> and <span className="text-primary">PnL</span> are HolderScan&apos;s FIFO aggregates in USD. Top-10 and top-100 share are Σ of HolderScan&apos;s top holders&apos; balances ÷ circulating supply, pools included.</p>
          <p>Scored cells: holder growth (HolderScan&apos;s 24h change), holders over $1K (24h change between readings, once ~19h exist) and diamond-hands share; price vs break-even is context, because a holder base in profit is both healthy and a source of sell pressure. The thresholds are first guesses on one day of data (2026-09-12) and will be revisited as the readings accumulate.</p>
        </div>
      </Section>

      <Section title="Holders across the ecosystem" id="holders">
        <div className="text-sm text-secondary space-y-2 leading-relaxed">
          <p>The <Link href="/holders" className="underline underline-offset-2 hover:text-primary">Holders page</Link> starts from the whole universe of quote assets: every pair StonkFun lists that has at least one reward-mode coin launched against it, in every category (tokenized stocks, pre-IPO, crypto, stablecoins, SOL, leverage, collectibles — about 320 assets). Two figures per asset, from two providers, never added together. <span className="text-primary">Holders</span> is HolderScan&apos;s count of wallets with any balance of the asset on any venue, read every hour on HolderScan&apos;s Advanced plan (once a day on Standard); assets HolderScan does not track show no reading. <span className="text-primary">StonkFun wallets</span> is this site&apos;s own daily on-chain census: for the largest reward coins by holder count (up to a fixed page budget, so the figure is a floor and the page says what share of StonkFun&apos;s holder-slots it covers), every wallet with a balance, read from token accounts via Helius and de-duplicated by owner — overall, per category and per quote asset. No address is stored, only counts. A wallet in that census holds a coin that pays it the quote asset on every payout, which is why it is the headline: it is the set of holders the ecosystem creates or keeps for other projects&apos; tokens. Share is StonkFun wallets ÷ holders for the same asset.</p>
          <p>The 24h, 7d and 30d columns are the difference between the newest reading and the newest reading at or before the window start, shown once readings cover at least 80% of the window (two daily readings for 24h, about six days for 7d, 24 for 30d). Holder readings are kept for 60 days; census runs indefinitely (a few hundred rows a day).</p>
          <p>The third count, <span className="text-primary">on-chain</span>, is this site&apos;s own tally of owner addresses with a non-zero balance of the asset itself, read from token accounts via Helius every six hours for every asset in the universe. It measures the same thing as HolderScan&apos;s holders a second way, covers assets HolderScan does not track, and is the per-asset side of the &ldquo;wallets holding a stock token&rdquo; block, which de-duplicates the same pull across the xStocks, Backpack, pre-stock and Tessera assets (a wallet holding several counts once, and any issuer subset can be selected). A mint with more token accounts than one run reads is shown as a floor with a &ldquo;≥&rdquo;. Holding the stock token and holding a StonkFun coin that pays it are different populations — neither contains the other — which is why the page keeps them as separate columns rather than one number.</p>
        </div>
      </Section>

      <Section title="What this site does not know" id="unknown">
        <ul className="text-sm text-secondary space-y-2 leading-relaxed list-disc pl-5">
          <li>STONK has no USD market of its own. Its USD price is the pool ratio × SPYx&apos;s USD price, so it carries S&amp;P 500 beta, and SPYx has no live reference price outside US market hours, which lets the USD figure drift over weekends and gap at Monday open.</li>
          <li>Burn rate is a spot rate from the most recent ~25 burn events (roughly one to two hours). It swings with platform activity.</li>
          <li>Daily buyback dollars are estimated as daily revenue × lifetime buyback share until the site&apos;s own history has enough recorded buybacks.</li>
          <li>Pool depth and net flow cover the main Raydium pool only. STONK also trades through Jupiter routing and in every STONK-quoted pool.</li>
          <li>Holder counts, tiers, hold times and PnL come from HolderScan&apos;s indexer, and concentration and wallet tags from GMGN&apos;s, not from this site&apos;s own on-chain reads (the wallet census on the Holders page is the one on-chain count). GMGN&apos;s 24h volume counts every STONK-quoted pool, so it is many times the main pool&apos;s volume; the two figures measure different things.</li>
          <li>Platform revenue is volatile: daily fees have spanned roughly two orders of magnitude since launch (the live range is in &quot;What to watch&quot; on the $STONK page). Buyback pressure follows it with no lag, in both directions.</li>
        </ul>
      </Section>

      <p className="num text-xs text-muted">
        Built from public data. Every tile shows its source; start at <Link href="/" className="text-secondary hover:text-primary">the $STONK page</Link>. Corrections: @stonk_fyi on X.
      </p>
      </article>
    </div>
  );
}
