# stonk.fyi — $STONK metrics, scored live

**Live at [stonk.fyi](https://stonk.fyi).** Methodology and data sources: [stonk.fyi/about](https://stonk.fyi/about).

A live dashboard centered on **$STONK**, the platform token of the [StonkFun](https://www.stonkfun.xyz) launchpad on Solana. The home page is a bull-case scorecard — supply burned, burn velocity, buyback pressure, revenue growth, STONK-denominated demand, valuation multiple — each computed live from the API and colored by its actual state, plus price, burn and buyback charts and a "what to watch" block. The rest of the site covers the platform that feeds the flywheel. Unofficial; built on StonkFun's public API.

## How it works

**Phase 1 (this repo):** every page is a Next.js server component that reads StonkFun's keyless public API (`https://www.stonkfun.xyz/api/public/v1`) with short revalidation windows, and a small client component re-renders the page every 60 seconds. No database needed.

**Phase 2 (included, opt-in):** `/api/cron/snapshot` is a worker that polls the API on a schedule and writes time-series rows into Postgres (Supabase). That is what turns StonkFun's "current values" into history you can chart — per-token price/mcap/volume over time, buyback ledger, launch counts per day, volume by pair over time. The schema is in `supabase/migrations/0001_init.sql` and the cron schedule in `vercel.json` (active tokens every 5 min, full walk hourly).

**Phase 3 (not started):** direct on-chain reads via Helius (unique traders, holder distributions, burn verification against the STONK mint, pool liquidity).

## Pages

| Route | What it shows |
|---|---|
| `/` | **$STONK**: hero metrics, bull-case scorecard (13 indicators in 5 groups), price history (CoinGecko), supply-burned ring, buyback-per-day and cumulative buyback charts, recent STONK burns with tx links, live buyback feed, main-pool reserves and 24h net flow (Raydium), interactive flywheel projection (floor / ceiling models), tokens priced in STONK, what to watch |
| `/platform` | Platform KPIs, daily revenue (holders vs protocol), cumulative revenue, burn share by source, live buyback feed, top tokens |
| `/tokens` | Searchable, filterable, paginated token table (sort, status, mode, pair category, quote mint) |
| `/tokens/[mint]` | Token detail: market, launch, addresses, burns/rewards/fees/backing sub-resources |
| `/pairs` | Volume and market cap aggregated by quote asset and pair category (StonkFun's unique angle) |
| `/flywheel` | Revenue → buyback → burn: totals, burn sources, buyback spend by quote, holder rewards |
| `/launches` | Launch ledger, launches per hour, mode and launchpad split |
| `/about` | Methodology, data sources, scorecard thresholds, projection model, known gaps |

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev                        # live API
DATA_SOURCE=fixture npm run dev    # offline, uses captured JSON in src/fixtures
```

## Deploy (Vercel + Supabase)

1. Push to GitHub, import into Vercel. It deploys as-is with live API data.
2. Create a Supabase project, run `supabase/migrations/0001_init.sql` in the SQL editor.
3. Add env vars in Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (any long random string — Vercel sends it as the bearer token to cron routes).
4. Redeploy. Vercel Cron will start calling `/api/cron/snapshot`. Hit it manually with `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/snapshot` to check the JSON result.

History accumulates from the moment the worker starts, so turn it on early.

## Troubleshooting

Open `http://localhost:3000/api/health` — it pings every upstream (StonkFun endpoints, Raydium, CoinGecko, Supabase) and reports ok/fail with a note per source, so a blank section on a page can be traced to the source that's failing. Typical causes: a corporate/VPN proxy blocking one host, StonkFun's 300 req/min rate limit (wait a minute), or CoinGecko rate-limiting (chart falls back to a placeholder; add `COINGECKO_API_KEY` for a free demo key).

## Caveats

- The API is a launchpad's public endpoint, not a versioned data contract. Fields may change; the client is typed defensively and the error boundary surfaces failures.
- USD values come from StonkFun's own pricing feed. For independent numbers, cross-check with Jupiter's price API or DexScreener (planned).
- Rate limit is 300 req/min per IP. A full token walk (12k+ tokens) is ~125 requests; the worker stays comfortably under that.
- `src/fixtures/*.json` are real responses captured 2026-09-06 for offline development.
- Price history comes from CoinGecko's public `market_chart` endpoint (coin id `stonk-2`, override with `COINGECKO_STONK_ID`; optional `COINGECKO_API_KEY` for a demo key). It is best-effort: on any failure the chart shows a placeholder instead of erroring. Not verified from the build environment.
- Pool reserves, TVL, fee and pool volume come from Raydium's public `api-v3.raydium.io/pools/info/ids` endpoint for the STONK/SPYx CLMM pool. The worker records them to `pool_snapshots`; the 24h change in the STONK reserve is shown as net flow (reserve falling = net buying). The net-flow indicator reads "collecting" until ~24h of snapshots exist.
- The flywheel projection is a mechanical model of one input (revenue-funded buybacks). "Floor" holds market cap constant and only shrinks supply; "Ceiling" pushes every buyback dollar through a constant-product curve with the live quote-side depth and no sellers. Real price is set by the rest of the order flow. Not a forecast, not advice.
- The scorecard's thresholds (what counts as bullish / neutral / caution) live in `src/lib/stonk.ts` and are deliberately simple; tune them to taste. Indicators are not investment advice.

## Layout

```
src/app/            routes (App Router)
src/app/api/cron/   snapshot worker
src/components/     charts (Recharts), tables, nav, live refresh
src/lib/api.ts      typed API client + fixture mode + CoinGecko
src/lib/stonk.ts    STONK aggregator: supply, burn rate, buyback pressure, pool, indicators
src/lib/raydium.ts  Raydium pool-info client
src/components/Projection.tsx  client-side flywheel projection (sliders)
src/lib/types.ts    API response types
src/lib/db.ts       Supabase client (optional)
supabase/           schema
scripts/            dev helpers (screenshot.mjs)
```
