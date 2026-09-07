# StonkFun Metrics — project handoff & working instructions

You are the engineering lead for **StonkFun Metrics**, a public-facing live dashboard for **$STONK**, the platform token of the StonkFun launchpad on Solana. This file is the single source of truth for how the project works, what has been verified, what hasn't, and how to keep building it. Read it fully before touching code.

---

## 1. What this is

**Product:** a website that tracks $STONK's performance with a bull-case scorecard computed from live data, plus supporting pages for the StonkFun platform (tokens, pairs, revenue flywheel, launches). The home page (`/`) is the STONK view; `/platform` is the launchpad overview.

**Audience:** the public — STONK holders, traders, and people evaluating the token. That has two consequences you must honor:

1. **Credibility over cheerleading.** Every scorecard indicator is computed from live data and colored by its actual state (bullish / neutral / caution / context). The page also carries a "What to watch" block with the counter-signals. Do not build anything that can only show green. A reader who would act on this page needs to trust it; a page that hides the bear case loses that trust the first time price drops. If the owner asks to remove caution states, push back once with this reasoning, then do what they decide.
2. **Provenance over assertion.** Every number links back to its source (an API endpoint, an on-chain tx signature via Solscan, Raydium). USD figures come from StonkFun's own pricing feed and are labeled as such. Burn amounts and tx signatures are on-chain and verifiable; dollar values are not.

**Status:** Phase 1 (API-polling site) is complete and verified working on live data by the owner. Phase 2 (snapshot worker → Postgres history) is written but has not been run against a real database. Phase 3 (on-chain via Helius) is not started.

---

## 2. Stack & layout

- **Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, Recharts 3.** Fonts via the `geist` npm package (self-hosted; Google Fonts is not used).
- Hosting target: **Vercel** (cron via `vercel.json`). Database target: **Supabase** (Postgres). Both optional for Phase 1.
- Every page is a **server component** with `export const dynamic = "force-dynamic"`; data is fetched server-side with short `next.revalidate` windows (30–600s). A tiny client component (`LiveRefresh`) calls `router.refresh()` every 60s so pages feel live without websockets.

```
src/app/                    routes
  page.tsx                  $STONK home (hero, scorecard, price, supply ring, buybacks, burns, pool, projection, quoted tokens, watch list)
  platform/page.tsx         launchpad overview (was the original home page)
  tokens/page.tsx           searchable/filterable/paginated token table (URL search params)
  tokens/[mint]/page.tsx    token detail
  pairs/page.tsx            volume & mcap by quote asset / category (aggregates top 300 by volume)
  flywheel/page.tsx         revenue → buyback → burn
  launches/page.tsx         launch ledger & velocity
  api/health/route.ts       per-upstream diagnostics (USE THIS FIRST when anything looks wrong)
  api/cron/snapshot/route.ts  snapshot worker (Phase 2)
  error.tsx                 error boundary
src/lib/
  api.ts                    typed StonkFun API client + fixture mode + CoinGecko history
  raydium.ts                Raydium pool-info client (STONK/SPYx reserves, TVL, pool volume)
  stonk.ts                  STONK aggregator: supply, burn rate, buyback pressure, pool, indicators, watch list, projection inputs
  db.ts                     Supabase client (null when unconfigured) + getPoolFlow()
  types.ts                  API response types (hand-derived from live responses)
  format.ts                 formatting helpers; nowMs() and cumulative() exist to satisfy the React Compiler lint
src/components/
  charts.tsx                Recharts wrappers (client). Formatting is chosen by a `fmt: "usd" | "count"` prop — never pass functions from server to client components
  Scorecard.tsx             indicator grid grouped by supply / flywheel / demand / platform / valuation
  Projection.tsx            client-side flywheel projection with sliders (floor & ceiling models)
  TokenTable.tsx, BuybackFeed.tsx, Nav.tsx, LiveRefresh.tsx, ui.tsx
src/fixtures/*.json         real API responses captured 2026-09-06/07, served when DATA_SOURCE=fixture
supabase/migrations/0001_init.sql   full schema (see §6)
scripts/screenshot.mjs, scripts/shot-section.mjs   Playwright screenshot helpers for visual verification
```

---

## 3. Data sources (verified shapes)

### StonkFun public API — `https://www.stonkfun.xyz/api/public/v1`
No API key. **300 req/min per IP** (25/min on `/launches/prepare`, 20/min on fee-claim prepare). OpenAPI spec at `/openapi.json`. Not a versioned contract — fields can change without notice, so the client is typed defensively and `/api/health` exists.

| Endpoint | Shape (under `data`) | Notes |
|---|---|---|
| `/stats` | `{ network, tokens:{total, graduated, aboutToGraduate, rewardLaunches, totalMarketCapUsd, totalVolume24hUsd}, revenue:{totalRevenueUsd,totalBuybackUsd}, burns:{totalValueUsdAtBurn,burnCount}, config:{graduationMarketCapUsd:40000, aboutToGraduateMarketCapUsd:32000, ...} }` | verified |
| `/revenue` | `{ revenue:{totalRevenueUsd,totalBuybackUsd,boughtBackTokens,boughtBackValueUsd,buybackCount,lastBuybackAt}, burns:{totalValueUsdAtBurn,burnCount,mintCount,bySource:{buyback,flywheel,reward,auto,quote-revenue,kickstart}}, config, recentBuybacks:[{signature,quote:{mint,symbol},spentTokens,spentValueUsd,boughtTokens,boughtValueUsd,burnSignature,boughtAt}] }` | verified; `recentBuybacks` is ~25 items |
| `/revenue/history` | `{ start:"2026-07-25", days:[{date,dailyRevenue,dailyHoldersRevenue,dailyProtocolRevenue}], coverage }` | verified |
| `/tokens` | `{ tokens:[Token], pagination:{page,pageSize,total,totalPages}, network }` params: `q, sort(marketCap|newest|volume), mode, status, quoteMint, category, page, pageSize(≤100)` | verified incl. `quoteMint` filter |
| **`/tokens/{mint}`** | **`{ token: Token, launch: Launch, network }`** — the token is NESTED under `data.token` | **This was the bug that broke the first live run.** `getToken()` now unwraps both shapes and throws on a third. Never assume the list shape here. |
| `/tokens/{mint}/burns` | `{ mint, totals:{amountTokens,valueUsdAtBurn,burnCount,lastBurnAt}, burns:[{signature,amountTokens,valueUsdAtBurn,source,burnedAt}] }` | verified; returns a recent window (~25–30), not the full ledger |
| `/tokens/{mint}/fees` | `{ mint, creator, claimable:{base,quote}, claimUrl, claimApi }` | verified |
| `/tokens/{mint}/rewards`, `/backing` | unknown shape; page dumps as JSON, tolerates 404/403 | not verified |
| `/launches` | `{ launches:[{mint,pool,name,symbol,creator,quote,launchpad,mode,transferFee,startMarketCapUsd,targetMarketCapUsd,createdAt}], pagination }` | verified |
| `/pairs` | `{ pairs:[{mint,symbol,name,decimals,logoUrl,category,categoryLabel,tokenProgram,launchable,launchLabReady}] }` (319 pairs) | verified |
| `/rewards` | `{ launches:[{mint,quote,distributedTokens,payoutCount,holderCount,lastPayoutAt}] }` | verified |

Token `market` block: `priceUsd, marketCapUsd, fdvUsd, volume24hUsd, priceChange24h?, liquidityUsd? (launchlab only), peakMarketCapUsd`. Relative `imageUrl`/`logoUrl` paths must be prefixed with `https://www.stonkfun.xyz` (`resolveImage()`).

### Raydium — `https://api-v3.raydium.io/pools/info/ids?ids=<pool>`
STONK's main pool `7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49` is a **Raydium CLMM (concentrated liquidity)**, program `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`, 1% fee. `mintA` = SPYx, `mintB` = STONK. Returns `price` (STONK per SPYx), `mintAmountA/B` (reserves), `tvl`, `day.volume`. Verified. ~$1.5M TVL on 2026-09-06.

### CoinGecko — `api.coingecko.com/api/v3/coins/stonk-2/market_chart?vs_currency=usd&days=90`
Coin id `stonk-2` confirmed. Public endpoint, no key at low volume; `COINGECKO_API_KEY` optional. Best-effort: returns null → price chart shows a placeholder. **Not yet confirmed working end-to-end from a deployment**; check `/api/health`.

### Constants (`src/lib/stonk.ts`)
- `STONK_MINT = 6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx`
- `STONK_POOL = 7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49`
- `STONK_INITIAL_SUPPLY = 1_000_000_000` (mint & freeze authority null; supply only falls)
- `STONK_LAUNCHED_AT = 2026-07-23T19:07:06.749Z`; launched at ~$5,081 mcap, graduated 16 min later.
- Circulating = initial − burned (from `/tokens/{mint}/burns` totals). Cross-check: `marketCapUsd / priceUsd` should be within ~1%.

---

## 4. The scorecard: what each indicator means and how it's scored

All in `src/lib/stonk.ts` → `indicators[]`. Thresholds are deliberately simple; tune with the owner, never silently.

| Key | Computation | Bullish when |
|---|---|---|
| burned | burned / 1B | > 5% |
| burnrate | tokens burned per hour over the recent burn window, as % supply/day | > 0.3%/day |
| buyback | 7d revenue × lifetime buyback share (`totalBuybackUsd/totalRevenueUsd`, ≈59%) / 7 | > $10K/day |
| buybackvol | daily buybacks / STONK 24h volume | > 1% |
| revgrowth | 7d revenue vs prior 7d | > +20% |
| buybackprice | price / (boughtBackValueUsd / boughtBackTokens) | > 1× |
| quoted | count of tokens with `quote.mint == STONK` (348 on 2026-09-07) | ≥ 50 |
| pooldepth | Raydium TVL | > $5M (neutral > $500K) |
| netflow | Δ STONK reserve in main pool over 24h from `pool_snapshots` (falling reserve = net buying) | net buying; shows "collecting" without DB |
| turnover | 24h volume / mcap | 2%–100% |
| change24 | priceChange24h | > 0 |
| platform | platform 24h volume | > $10M |
| launchmult | mcap / launch mcap | context only |
| ps | mcap / (7d revenue × 52) | < 10× |

**Projection (`Projection.tsx`)** models only the buyback flywheel: *floor* = mcap held constant, price = mcap / (supply − tokens burned); *ceiling* = every buyback dollar as a net buy through a constant-product curve with the live quote-side depth and no sellers. The ceiling is a deliberate over-estimate (CLMM has less slippage near price than constant-product; the other ~99% of order flow is unmodeled). Copy on the page says this. Never present it as a forecast.

**"What to watch" copy (keep accurate):** STONK has no USD market of its own — its USD price = pool ratio × SPYx USD price, so it carries S&P 500 beta; StonkFun's own SPYx-denominated chart only rises when STONK outruns the index; SPYx has no live reference price outside US market hours, so STONK's USD figure can drift over weekends and gap at Monday open. Do not describe holding STONK as "short the index" — that was an earlier, incorrect shorthand.

---

## 5. Working rules

1. **Verify shapes against the live API before trusting a fixture.** Fixtures in `src/fixtures/` are real but can be stale or (as happened once) captured from a different endpoint's shape. When adding an endpoint: fetch it live, save the raw response as a fixture, type it in `types.ts`, then code against the type.
2. **Run `/api/health` first** when the owner reports "X doesn't work". It reports ok/fail + a note for every upstream. Ask for that JSON and the `npm run dev` terminal output rather than guessing.
3. **Server → client boundary:** never pass functions or class instances as props to `"use client"` components (Next throws at render). Use named-option props (`fmt="usd"`) as `charts.tsx` does.
4. **React Compiler lint is on** (`react-hooks/purity`, `react-hooks/immutability`). No `Date.now()` in components (use `nowMs()` from `format.ts`), no `let acc; arr.map(() => acc += …)` (use `cumulative()`). Run `npx eslint src` and `npx tsc --noEmit -p .` before every handoff; both must be clean.
5. **Verify visually.** `DATA_SOURCE=fixture npx next build && DATA_SOURCE=fixture npx next start -p 3111`, then `CHROME_PATH=<chromium> node scripts/screenshot.mjs http://localhost:3111` and look at the PNGs. Tables must scroll inside their container (`.table-wrap`), never the page. Broken avatar images in fixture mode are expected (no network); live they load.
6. **Rate limits.** Home page ≈ 8 upstream requests; pairs page = 3; a full token walk = ~160 requests (16k tokens / 100). Keep `revalidate` windows; don't add per-row fetches.
7. **Dark theme only, by design.** Palette lives in `globals.css` (`--series-1..8` follow the validated dark-mode data-viz palette: blue, orange, aqua, yellow, magenta, green, violet, red). Categorical colors are assigned in fixed order, never cycled by rank. One y-axis per chart, no dual axes.
8. **Copy discipline.** Plain language, no hype adjectives, no "genuinely/honestly". Every metric tile has a one-line `sub` explaining what it is. Caveats live next to the number they qualify, not in a footer.
9. **Not financial advice.** Keep the disclaimers that exist; don't add "buy" language anywhere.
10. **Commit hygiene** (if a repo is set up): conventional short messages; never commit `.env.local`; `next-env.d.ts` and `.next/` are generated.

---

## 6. Phase 2 — snapshot worker (written, unrun)

`GET /api/cron/snapshot` (auth: `Authorization: Bearer $CRON_SECRET`; Vercel adds it automatically for cron). Steps, each isolated so one failure doesn't stop the others: `platform` (stats+revenue → `platform_snapshots`, recent buybacks → `buybacks`), `revenue_daily`, `launches`, `stonk_burns` (→ `token_burns`), `pool` (Raydium reserves → `pool_snapshots`), `tokens` (active tokens with volume>0 → `tokens` + `token_snapshots`; `?full=1` walks every page). Schedule in `vercel.json`: every 5 min, plus hourly full walk. Schema: `supabase/migrations/0001_init.sql` (also views `launches_per_day`, `volume_by_quote_latest`, `stonk_burns_daily`).

**To bring it up:** create a Supabase project → run the migration in the SQL editor → set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` in Vercel → redeploy → `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/snapshot` and read the `counts`/`errors` JSON. Expect first-run fixes (column type mismatches are the likely class of bug). History only accumulates from the moment it runs, so this is the highest-leverage next task.

**What unlocks once data exists:** real STONK price/mcap/volume charts on the token page (replace the "Price history" placeholder), burns-per-day over full history, buyback USD per day from the actual ledger instead of the revenue × share estimate, the net-flow indicator, volume-by-pair over time, and STONK-quoted-token count over time.

---

## 7. Roadmap (in priority order)

1. **Deploy to Vercel + turn on Supabase worker** (§6). Confirm `/api/health` all-green including CoinGecko.
2. **Wire DB-backed charts** into the STONK page and token detail; add a `getStonkHistory()` in `db.ts` reading `token_snapshots` for `STONK_MINT`.
3. **Independent price check:** Jupiter price API or DexScreener for STONK, shown beside StonkFun's USD price with the spread. Reduces reliance on StonkFun's pricing feed.
4. **Phase 3 on-chain (Helius):** holder count & top-holder concentration for STONK (a big missing indicator for a public site), unique traders/day, on-chain verification of burn totals against the mint's supply, pool liquidity distribution around the current tick (would make the projection ceiling realistic).
5. **Public-site polish:** OG image / social card, `robots.txt`, sitemap, analytics, a `/about` page describing methodology and data sources (the tables in §3–4 are the seed for it), mobile pass on the scorecard grid and projection sliders, light theme if the owner wants one.
6. **Alerts (optional):** a scheduled job that posts to Telegram/X when an indicator flips, a burn milestone passes (e.g. 15% of supply), or revenue sets a daily record.

---

## 8. Environment

```
DATA_SOURCE=live | fixture          # fixture = offline dev on captured JSON
STONKFUN_API_BASE                   # override, default https://www.stonkfun.xyz/api/public/v1
RAYDIUM_API_BASE                    # override, default https://api-v3.raydium.io
COINGECKO_STONK_ID=stonk-2          # optional; COINGECKO_API_KEY optional demo key
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET   # Phase 2 only
```

Run: `npm install && npm run dev` → http://localhost:3000. Health: `/api/health`. Offline: `DATA_SOURCE=fixture npm run dev`.

---

## 9. Known gaps & honest notes

- Burn velocity is computed from the burns endpoint's recent window (~25 events, ~1–2h). It's a spot rate and swings with platform activity; the label says "at this pace."
- `/tokens/{mint}/burns` does not paginate the full 10k+ ledger (or we haven't found how); full history comes from the worker accumulating it.
- Daily buyback dollars on the home page are an estimate (daily revenue × lifetime buyback share) until the worker records real buybacks.
- STONK also trades outside the main pool (Jupiter routing, and every STONK-quoted pool holds STONK). The pool-depth and net-flow indicators cover the main pool only.
- Platform revenue is volatile (from <$20K to >$1.5M/day in the first six weeks). Buyback pressure follows it with no lag.
- The scorecard thresholds are judgment calls made on ~6 weeks of data. Revisit them as history accumulates, and say so on the page if they change.
- StonkFun is a third-party launchpad; this site is unofficial and must keep saying so (footer + about).
