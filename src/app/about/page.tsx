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
      ["Buybacks vs volume", "estimated daily buybacks ÷ STONK 24h volume", "> 1%"],
      ["Revenue growth", "last 7 days of platform revenue vs the 7 days before", "> +20%"],
      ["Price vs avg buyback", "price ÷ (total USD spent on buybacks ÷ tokens bought back)", "> 1×"],
    ],
  },
  {
    group: "Demand",
    rows: [
      ["STONK-quoted activity", "24h volume through pools whose quote asset is STONK (the count of such pools only rises, so it is not scored)", "> $1M (neutral > $100K)"],
      ["Pool depth", "Raydium TVL of the main STONK/SPYx pool", "> $5M (neutral above $500K)"],
      ["Net flow", "change in the pool's STONK reserve over 24h; a falling reserve means net buying", "net buying"],
      ["Turnover", "24h volume ÷ market cap", "2% – 100%"],
      ["24h change", "StonkFun's reported 24h price change", "> 0"],
    ],
  },
  {
    group: "Holders & flow (GMGN)",
    rows: [
      ["Holders", "unique holder wallets; scored on 24h change once 12h of snapshots exist", "> +0.5% / 24h"],
      ["Top-10 concentration", "share of supply in the ten largest wallets, pools included", "< 20% (neutral below 35%)"],
      ["Buy share of volume", "24h buy volume ÷ (buy + sell volume) across every pool STONK trades in", "> 52% (neutral 48–52%)"],
      ["Smart money", "wallets GMGN tags as smart money currently holding STONK", "≥ 100 (neutral ≥ 25)"],
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

export default function AboutPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title="Methodology & data sources" sub={`What every number on ${SITE_NAME} means, where it comes from, and what this site does not know.`} />

      <Section title="What this is">
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

      <Section title="The token">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs [&_dd]:break-words [&_dd]:min-w-0 [&_a]:break-all">
          <dt className="text-muted">Mint</dt><dd><ExplorerLink addr={STONK_MINT} kind="token" /></dd>
          <dt className="text-muted">Main pool</dt><dd><ExplorerLink addr={STONK_POOL} /> <span className="text-muted">Raydium CLMM, STONK / SPYx, 1% fee</span></dd>
          <dt className="text-muted">Launched</dt><dd className="num">{new Date(STONK_LAUNCHED_AT).toUTCString()}, graduated 16 minutes later</dd>
          <dt className="text-muted">Supply</dt><dd>1,000,000,000 fixed. Mint and freeze authority are null, so supply can only fall. Circulating = initial − burned.</dd>
        </dl>
      </Section>

      <Section title="Data sources">
        <div className="text-sm text-secondary space-y-3 leading-relaxed">
          <p>
            <span className="text-primary">StonkFun public API</span> (<code className="font-mono text-xs">stonkfun.xyz/api/public/v1</code>): platform
            stats, revenue and buyback history, token list and market data, burn ledger, launches, pairs, rewards. This is the source of every USD figure
            on the site. StonkFun&apos;s pricing feed is not independently verified here; treat dollar values as StonkFun&apos;s numbers. Burn amounts and
            transaction signatures are on-chain and link to Solscan.
          </p>
          <p>
            <span className="text-primary">Raydium</span> (<code className="font-mono text-xs">api-v3.raydium.io</code>): reserves, TVL and 24h volume of
            the main STONK/SPYx pool. Used for pool depth, net flow, and the projection&apos;s quote-side depth.
          </p>
          <p>
            <span className="text-primary">GMGN</span> (<code className="font-mono text-xs">openapi.gmgn.ai</code>): holder count, top-10 concentration,
            wallet tags (smart money, KOL, whales), buy and sell volume across every pool STONK trades in, contract and LP checks, and an
            independent USD price from STONK&apos;s largest pool by liquidity. Shown under the price as a spread against StonkFun&apos;s figure.
            Optional; the &quot;Holders &amp; flow&quot; section is absent when GMGN is unavailable.
          </p>
          <p>
            <span className="text-primary">CoinGecko</span>: 90-day USD price history for the price chart. Best-effort; the chart shows a placeholder when
            it is unavailable.
          </p>
          <p>
            Pages refresh every 60 seconds; upstream data is cached for 30 seconds to 10 minutes depending on how fast it changes. The snapshot time is
            shown at the top of the $STONK page.
          </p>
        </div>
      </Section>

      <Section title="What is scored, and what is not">
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
                  <tr><td colSpan={3} className="text-[11px] uppercase tracking-wide text-muted !py-2">{g.group}</td></tr>
                  {g.rows.map(([label, how, when]) => (
                    <tr key={label}>
                      <td className="text-primary">{label}</td>
                      <td className="!whitespace-normal text-secondary">{how}</td>
                      <td className="num">{when}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="The projection">
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

      <Section title="What this site does not know">
        <ul className="text-sm text-secondary space-y-2 leading-relaxed list-disc pl-5">
          <li>STONK has no USD market of its own. Its USD price is the pool ratio × SPYx&apos;s USD price, so it carries S&amp;P 500 beta, and SPYx has no live reference price outside US market hours, which lets the USD figure drift over weekends and gap at Monday open.</li>
          <li>Burn rate is a spot rate from the most recent ~25 burn events (roughly one to two hours). It swings with platform activity.</li>
          <li>Daily buyback dollars are estimated as daily revenue × lifetime buyback share until the site&apos;s own history has enough recorded buybacks.</li>
          <li>Pool depth and net flow cover the main Raydium pool only. STONK also trades through Jupiter routing and in every STONK-quoted pool.</li>
          <li>Holder count, concentration and wallet tags come from GMGN&apos;s indexer, not from this site&apos;s own on-chain reads. GMGN&apos;s 24h volume counts every STONK-quoted pool, so it is many times the main pool&apos;s volume; the two figures measure different things.</li>
          <li>Platform revenue has ranged from under $20K to over $1.5M per day since launch. Buyback pressure follows it with no lag, in both directions.</li>
        </ul>
      </Section>

      <p className="text-xs text-muted">
        Questions about a number? Every tile shows its source. Start at <Link href="/" className="underline underline-offset-2 hover:text-primary">the $STONK page</Link>.
      </p>
    </div>
  );
}
