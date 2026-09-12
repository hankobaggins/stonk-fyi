# StonkFun Metrics — project handoff & working instructions

You are the engineering lead for **StonkFun Metrics**, a public-facing live dashboard for **$STONK**, the platform token of the StonkFun launchpad on Solana. This file is the single source of truth for how the project works, what has been verified, what hasn't, and how to keep building it. Read it fully before touching code.

---

## 1. What this is

**Product:** a website that tracks $STONK's performance with a bull-case scorecard computed from live data, plus supporting pages for the StonkFun platform (tokens, pairs, revenue flywheel, launches). The home page (`/`) is the STONK view; `/platform` is the launchpad overview.

**Audience:** the public — STONK holders, traders, and people evaluating the token. That has two consequences you must honor:

1. **Credibility over cheerleading.** Every scorecard indicator is computed from live data and colored by its actual state (bullish / neutral / caution / context). The page also carries a "What to watch" block with the counter-signals. Do not build anything that can only show green. A reader who would act on this page needs to trust it; a page that hides the bear case loses that trust the first time price drops. If the owner asks to remove caution states, push back once with this reasoning, then do what they decide.
2. **Provenance over assertion.** Every number links back to its source (an API endpoint, an on-chain tx signature via Solscan, Raydium). USD figures come from StonkFun's own pricing feed and are labeled as such. Burn amounts and tx signatures are on-chain and verifiable; dollar values are not.

**Status (2026-09-07):** **Live at https://stonk.fyi.** Phase 1 (API-polling site) is deployed and verified from production (`/api/health` all green, CoinGecko included). Phase 2 (snapshot worker → Supabase) is **running**: first run 2026-09-07 20:44 UTC, no first-run bugs, ticking every 5 min. Phase 3 (on-chain via Helius) is not started. See §10 for the production setup and how to operate it.

**Brand:** the site is called **stonk.fyi** (nav, titles, OG card), not "StonkFun Metrics" — keeping StonkFun's name out of the masthead reinforces the unofficial status. `src/lib/site.ts` holds the name, tagline, description and canonical URL.

---

## 2. Stack & layout

- **Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, Recharts 3.** Fonts via the `geist` npm package (self-hosted; Google Fonts is not used).
- Hosting target: **Vercel** (cron via `vercel.json`). Database target: **Supabase** (Postgres). Both optional for Phase 1.
- Every page is a **server component** with `export const dynamic = "force-dynamic"`; data is fetched server-side with short `next.revalidate` windows (30–600s). A tiny client component (`LiveRefresh`) calls `router.refresh()` every 60s so pages feel live without websockets.

```
src/app/                    routes
  page.tsx                  $STONK home (hero, scorecard, price, supply ring, buybacks, burns, pool, projection, quoted tokens, watch list)
  platform/page.tsx         launchpad overview (was the original home page)
  tokens/page.tsx           "Tokens & yield": searchable/filterable token table (URL search params) with realized holder-fee APR columns
                            (24h / 3d bars, `getAprForTokens`) on every row — "—" for standard coins, "not tracked" for reward coins outside
                            the YIELD_TRACKED=200 set — and every numeric column header sortable (`?by=<key>&dir=`): the page loads a pool of
                            the first 500 tokens in StonkFun's order (`?sort=` market cap / volume / newest, 5×100 requests, 30s cache) and
                            sorts/pages the pool itself. Buy button (JTX) where the Mode column was. Merged from /yield 2026-09-11
  tokens/[mint]/page.tsx    token detail
  pairs/page.tsx            volume & mcap by quote asset / category (aggregates top 300 by volume)
  flywheel/page.tsx         revenue → buyback → burn
  launches/page.tsx         launch ledger & velocity
  yield/page.tsx            redirect → /tokens?mode=reward&by=apr3 (the table lived here 2026-09-09 → 2026-09-11). `getYieldTable()` in lib/yield.ts still
                            exists for /yield-card and /api/health (needs migration 0005 + the `rewards` worker step)
  holders/page.tsx          ecosystem view first (§6g: wallets holding a reward coin, category tiles, every universe quote asset with
                            HolderScan holders + StonkFun wallets + share; migration 0011, HOLDERSCAN_API_KEY), then the stock-quoted
                            hourly blocks: wallet census block (§6f: unique wallets across all quote assets, issuer multi-select, 24h/7d/30d, chart) then
                            unique holders of the stock-quoted side: every xstock/backpack/prestock/tessera quote asset (GMGN holder
                            count) and the 100 largest reward coins quoted in them (StonkFun holderCount), 24h and 7d change from hourly
                            `holder_snapshots` (added 2026-09-10; needs migration 0009 + the hourly `holders` worker step on the :30 tick, §6e)
  about/page.tsx            methodology, data sources, scorecard thresholds, projection model, known gaps (public)
  api/buybacks/route.ts     protocol-event feed for the toasts: recent buybacks + non-buyback STONK burns, sorted (no-store; upstream 20-30s)
  api/health/route.ts       per-upstream diagnostics (USE THIS FIRST when anything looks wrong)
  api/cron/snapshot/route.ts  snapshot worker (Phase 2) — tiered cadence, see §6; includes the burn_alert step (§6a)
  burn-card/[id]/route.tsx  1600×900 PNG for a big-burn alert (what gets tweeted; /burn-card/preview for eyeballing)
  ath-card/route.tsx        1200×1200 PNG for an all-time-high post (headline = StonkFun's peakMarketCapUsd, plus where it stands now,
                            24h change, peak vs launch, supply burned). Card itself is the pure `lib/ath-card.tsx`, rendered live; nothing stored
  ath-card/[id]/route.tsx   the same card from a stored `ath_alerts` row (what the worker's ath_alert step posts, §6d); seeded/quiet rows 404
  milestone-card/[id]/route.tsx  1200×1200 PNG for a burn milestone (id = whole percent, e.g. /milestone-card/14; /milestone-card/preview
                            renders the current level live). Card is the pure `lib/milestone-card.tsx`; the worker step is §6c
  buyback-card/route.tsx    1200×1200 PNG: top 5 quote coins by USD spent buying STONK over `?hours=N` (default 1), from the
                            `buybacks` ledger via `getBuybackLeaderboard()` (added 2026-09-09). `?format=json` returns the numbers.
                            Card is the pure `lib/buyback-card.tsx`, big figures only, bars in `--up`. 503 when the DB is unset or the window is empty. Note "coins"
                            here are the fee/quote assets that funded buybacks — the API has no per-launched-token revenue figure
  yield-card/route.tsx      1600×900 PNG: top 10 coins on the /yield table by USD paid to holders over `?window=3d` (default) or `24h`, APR beside each
                            (added 2026-09-10). `?format=json` returns the board. Card is the pure `lib/yield-card.tsx` (`yieldBoard()` does the
                            ranking), same masthead/footer/palette as the buyback card, bars in `--accent`, wide layout: headline + totals left, ranking right.
                            503 when the DB is unset, still collecting, or no coin has a full window. Offline sample render:
                            `Claude outputs/render-yield-card-sample.tsx` (copy to the repo root, `npx tsx --tsconfig tsconfig.json`)
  og/route.tsx              social card (next/og; carries the live tally bar). A route, not the opengraph-image file convention: that
                            convention hashes the URL per build and scrapers cache by URL, so shares showed a stale price. layout.tsx
                            `generateMetadata` points og:image/twitter:image at `/og?v=<5-min bucket>` (`ogImageUrl` in site.ts)
  icon.svg (burn ring favicon), robots.ts, sitemap.ts
  error.tsx                 error boundary
src/lib/
  api.ts                    typed StonkFun API client + fixture mode + CoinGecko history
  raydium.ts                Raydium pool-info client (STONK/SPYx reserves, TVL, pool volume)
  stonk.ts                  STONK aggregator: supply, burn rate, buyback pressure, pool, indicators, watch list, projection inputs
  db.ts                     Supabase client (null when unconfigured) + getPoolFlow() + getGmgnHistory()
  gmgn.ts                   GMGN OpenAPI client → normalized GmgnData (holders, concentration, buy/sell volume, wallet tags, security, price)
  types.ts                  API response types (hand-derived from live responses)
  format.ts                 formatting helpers; nowMs() and cumulative() exist to satisfy the React Compiler lint
  site.ts                   SITE_URL / SITE_NAME / tagline / description (NEXT_PUBLIC_SITE_URL overrides the origin)
  jtx.ts                    JTX affiliate trade URL (`ref=stonk`), client-safe; see working rule 13
src/components/
  charts.tsx                Recharts wrappers (client). Formatting is chosen by a `fmt: "usd" | "count"` prop — never pass functions from server to client components
  Foundation.tsx            one-way facts block (burn ring at 128px, supply ledger, contract/LP checklist) — unscored by design
  Scorecard.tsx             indicator sections (flywheel / demand / holders & flow / platform & valuation) + TallyBar + "What to watch" frame
  Ticker.tsx, BurnRing.tsx  mono ticker strip under the nav (incl. implied SPYx price + US market-hours note); the ring mark
  BuybackToasts.tsx, AlertsToggle.tsx   site-wide toast per protocol buyback batch and per non-buyback STONK burn (polls /api/buybacks
                            every 20s, dedupes by id, groups a batch by shared burn tx, replays only the newest batch on load if <5m old;
                            mute in localStorage via lib/alerts.ts). Cadence is the protocol's: buyback sweeps ~every 5-10m, quote-revenue
                            burns in between, so expect a toast every 2-5 minutes, not continuously.
  Projection.tsx            client-side flywheel projection with sliders (floor & ceiling models)
  TokenTable.tsx, BuybackFeed.tsx, Nav.tsx, LiveRefresh.tsx, ui.tsx
  BuyButton.tsx             `BuyButton` (nav / hero / token header) and `TradeLink` (table cell) → JTX with the referral code
src/fixtures/*.json         real API responses captured 2026-09-06/07, served when DATA_SOURCE=fixture
src/lib/burn-milestones.ts, milestone-math.ts   burn-milestone worker step (§6c) and its pure math (scripts/burn-milestone-check.ts)
src/lib/ath-alerts.ts, ath-math.ts   all-time-high worker step (§6d) and its pure math (scripts/ath-alert-check.ts)
supabase/migrations/0001_init.sql   full schema incl. RLS (see §6) — applied to production 2026-09-07
supabase/migrations/0005_reward_snapshots.sql   reward_snapshots table — paste into the SQL editor by hand
supabase/migrations/0006_reward_snapshots_scoped.sql   reward_payout_window(win_hours, mints) + reward_snapshots_prune() + one-off cleanup of 0005's 1.2M rows (2026-09-10) — by hand too
supabase/migrations/0007_burn_milestones.sql   burn_milestones table (§6c) — paste into the SQL editor by hand
supabase/migrations/0010_wallet_census.sql   wallet_runs + wallet_run_meta + wallet_mint_counts (§6f) — paste by hand
supabase/migrations/0011_universe_holders.sql   quote_holder_snapshots + quote_holder_window() + coin_census_runs/quotes/categories (§6g) — paste by hand
supabase/migrations/0012_quote_holder_deltas.sql   quote_holder_deltas: HolderScan's own 7/14/30-day changes (§6g backfill) — paste by hand
supabase/migrations/0013_coin_holder_deltas.sql   coin_holder_deltas: HolderScan deltas per reward coin → "holders added to StonkFun coins" (§6g) — paste by hand
src/lib/holderscan.ts, universe.ts   HolderScan client (all routes, §6h); the universe of quote assets, the universe_holders step, the page's rows (§6g)
src/lib/stonk-holders.ts, components/HolderBase.tsx   STONK's HolderScan profile: worker step, reads, the home-page block (§6h)
supabase/migrations/0014_holderscan_profiles.sql   holderscan_snapshots + series/prune fns, d1/d3 delta columns, holder_window per source (§6h) — paste by hand
supabase/migrations/0009_holder_snapshots.sql   holder_snapshots + holder_window(win_hours, mints) + holder_snapshots_prune() (§6e) — paste by hand
supabase/migrations/0008_ath_alerts.sql   ath_alerts table (§6d) — paste into the SQL editor by hand
supabase/migrations/0002_gmgn_snapshots.sql   gmgn_snapshots table (holder count etc. per tick) — apply in the SQL editor if the GitHub integration doesn't
.github/workflows/snapshot.yml      the 5-minute snapshot tick (Vercel Hobby cron is daily-only)
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
| `/tokens/{mint}/fees` | `{ mint, creator, claimable:{base:{symbol,amountTokens},quote:{…}}, claimUrl, claimApi }`; reward coins: `{ creator:null, claimable:null, reason }` | verified; typed as `TokenFees` |
| `/tokens/{mint}/rewards` | reward mode: `{ mint, mode:"reward", quote:{mint,symbol,decimals}, rewards:{distributedTokens,undistributedTokens,payoutCount,holderCount,lastPayoutAt} }`; standard mode: `{ mode:"standard", message, rewards:null }` | verified 2026-09-07; typed as `TokenRewards` |
| `/tokens/{mint}/backing` | **400** `"Backing is only tracked for Pump launches"` for nearly every mint (incl. STONK). Shape for Pump launches unverified; page dumps JSON when present | **This 400 broke every token detail page until 2026-09-07**: `optional()` only swallowed 404/403. It now treats any 4xx as null and the token page uses per-section `settle()` so one failed extra never takes the page down. |
| `/launches` | `{ launches:[{mint,pool,name,symbol,creator,quote,launchpad,mode,transferFee,startMarketCapUsd,targetMarketCapUsd,createdAt}], pagination }` | verified |
| `/pairs` | `{ pairs:[{mint,symbol,name,decimals,logoUrl,category,categoryLabel,tokenProgram,launchable,launchLabReady}] }` (319 pairs) | verified |
| `/rewards` | `{ launches:[{mint,quote,distributedTokens,payoutCount,holderCount,lastPayoutAt}], recentDistributions:[{signature,mint,quoteMint,amountTokens,holderCount,distributedAt}] }` — 6.5K launches, ~250 quote assets, **no USD anywhere**; the only USD figure for holder rewards is `dailyHoldersRevenue` in `/revenue/history` | verified 2026-09-08. `/rewards` page values per-coin payouts at current Jupiter prices (`src/lib/jupiter.ts`, `lite-api.jup.ag/price/v3`, 50 ids/call, 5 min cache) and shows both numbers side by side, labelled |

Token `market` block: `priceUsd, marketCapUsd, fdvUsd, volume24hUsd, priceChange24h?, liquidityUsd? (launchlab only), peakMarketCapUsd`. Relative `imageUrl`/`logoUrl` paths must be prefixed with `https://www.stonkfun.xyz` (`resolveImage()`).

### Raydium — `https://api-v3.raydium.io/pools/info/ids?ids=<pool>`
STONK's main pool `7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49` is a **Raydium CLMM (concentrated liquidity)**, program `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`, 1% fee. `mintA` = SPYx, `mintB` = STONK. Returns `price` (STONK per SPYx), `mintAmountA/B` (reserves), `tvl`, `day.volume`. Verified. ~$1.5M TVL on 2026-09-06.

### CoinGecko — `api.coingecko.com/api/v3/coins/stonk-3/market_chart?vs_currency=usd&days=90`
Coin id is **`stonk-3`** (verified from production 2026-09-07: homepage stonkfun.xyz, price and mcap match StonkFun's). The earlier note saying `stonk-2` was wrong — that id 404s. Public endpoint, no key; `COINGECKO_API_KEY` optional. Best-effort: returns null → price chart shows a placeholder. Working end-to-end from Vercel (812 points back to launch).

### GMGN OpenAPI — `https://openapi.gmgn.ai` (optional, `GMGN_API_KEY`)
Client in `src/lib/gmgn.ts`. Read-only routes used: `GET /v1/token/info`, `/v1/token/security` (top_holders, weight 5, was dropped after production 429s) with `X-APIKEY` header plus `timestamp` and `client_id` query params (docs: github.com/GMGNAI/gmgn-skills, skills/gmgn-token/SKILL.md). Documented limit is a 20/s leaky bucket, but production hit 429s on the first deploy with one info+security+holders bundle per cold instance, so the free plan's real quota is lower; the result is now shared across instances via `unstable_cache` (60s) plus a per-instance memo, and `/api/health` reports the last GMGN error body. Key is created at https://gmgn.ai/ai (upload an Ed25519 public key; the matching private key is only needed for swap routes, which this site never calls). IPv4 only. Verified 2026-09-07 for STONK: 32.8K holders, top-10 18.1%, 318 smart-money / 61 KOL / 381 whale wallets, mint+freeze renounced, LP burned, 0 tax; 24h volume $63.7M **across all STONK pools** (StonkFun reports ~$2M for the main pool only); largest pool by liquidity is **Orca STONK/SOL, $2.45M** (`AfrddTGY…`), which gives a USD price independent of SPYx (spread shown under the hero price). Fixture: `src/fixtures/gmgn-stonk.json` (normalized subset, not the raw response). Neither the cloud sandbox nor the local VM can reach openapi.gmgn.ai; probe it from Chrome (CORS is open) or via `/api/health` on production.

### Constants (`src/lib/stonk.ts`)
- `STONK_MINT = 6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx`
- `STONK_POOL = 7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49`
- `STONK_INITIAL_SUPPLY = 1_000_000_000` (mint & freeze authority null; supply only falls)
- `STONK_LAUNCHED_AT = 2026-07-23T19:07:06.749Z`; launched at ~$5,081 mcap, graduated 16 min later.
- Circulating = initial − burned (from `/tokens/{mint}/burns` totals). Cross-check: `marketCapUsd / priceUsd` should be within ~1%.

---

## 4. The scorecard: what each indicator means and how it's scored

All in `src/lib/stonk.ts` → `indicators[]`. Thresholds are deliberately simple; tune with the owner, never silently.

**Scoring rule (owner decision 2026-09-07): only quantities that can objectively move both ways are scored.** One-way facts (supply burned %, fixed supply, renounced mint/freeze, LP burned, no tax) live in `Foundation.tsx` at the top of the home page, unscored, with the burn ring as the centerpiece. When a headline number only rises (tokens ever launched, pools ever quoted in STONK), score the flow behind it (24h volume) and show that flow as the cell's value. Never add a green cell that cannot turn amber.

| Key | Computation | Bullish when |
|---|---|---|
| ~~burned~~ | moved to Foundation (one-way, unscored) | — |
| burnrate (flywheel) | tokens burned per hour over the recent burn window, as % supply/day | > 0.3%/day |
| buyback | 7d revenue × lifetime buyback share (`totalBuybackUsd/totalRevenueUsd`, ≈59%) / 7 | > $10K/day |
| buybackvol | daily buybacks / STONK 24h volume | > 1% |
| revgrowth | 7d revenue vs prior 7d | > +20% |
| buybackprice | price / (boughtBackValueUsd / boughtBackTokens) | > 1× |
| quoted | 24h volume through STONK-quoted pools (count only rises → not the score) | > $1M (neutral > $100K) |
| pooldepth | Raydium TVL | > $5M (neutral > $500K) |
| netflow | Δ STONK reserve in main pool over 24h from `pool_snapshots` (falling reserve = net buying) | net buying; stays "collecting" (unscored) until ≥12h of pool readings exist — a few minutes of delta is noise, not a 24h flow |
| turnover | 24h volume / mcap | 2%–100% |
| change24 | priceChange24h | > 0 |
| holders (HolderScan; GMGN fallback) | HolderScan's count, scored on HolderScan's own 24h delta (§6h); GMGN's count scored on 24h change from `gmgn_snapshots` once ≥12h exist when HolderScan is unavailable | > +0.5%/24h (neutral ±0.5%) |
| holders1k (HolderScan) | holders with > $1K of STONK, 24h change between this site's readings | > +0.5%/24h (neutral ±0.5%) |
| diamond (HolderScan) | diamond-class share of the top-1000 wallets' supply | ≥ 50% (neutral ≥ 25%) |
| breakeven (HolderScan) | price ÷ holders' aggregate break-even | context only |
| top10 (GMGN) | top-10 holder share of supply | < 20% (neutral < 35%) |
| buypressure (GMGN) | buy ÷ (buy+sell) 24h volume, all pools | > 52% (neutral 48–52%) |
| smartmoney (GMGN) | smart-money wallets holding | ≥ 100 (neutral ≥ 25) |
| ~~safety (GMGN)~~ | moved to Foundation checklist (one-way, unscored) | — |
| platform | launchpad 24h volume (value shown is the volume, not the ever-rising token count) | > $10M (neutral > $1M) |
| launchmult | mcap / launch mcap | context only |
| ps | mcap / (7d revenue × 52) | < 10× |

**Projection (`Projection.tsx`)** models only the buyback flywheel: *floor* = mcap held constant, price = mcap / (supply − tokens burned); *ceiling* = every buyback dollar as a net buy through a constant-product curve with the live quote-side depth and no sellers. The ceiling is a deliberate over-estimate (CLMM has less slippage near price than constant-product; the other ~99% of order flow is unmodeled). Copy on the page says this. Never present it as a forecast.

**"What to watch" copy (keep accurate):** STONK has no USD market of its own — its USD price = pool ratio × SPYx USD price, so it carries S&P 500 beta; StonkFun's own SPYx-denominated chart only rises when STONK outruns the index; SPYx has no live reference price outside US market hours, so STONK's USD figure can drift over weekends and gap at Monday open. Do not describe holding STONK as "short the index" — that was an earlier, incorrect shorthand.

---

## 5. Working rules

1. **Verify shapes against the live API before trusting a fixture.** Fixtures in `src/fixtures/` are real but can be stale or (as happened once) captured from a different endpoint's shape. When adding an endpoint: fetch it live, save the raw response as a fixture, type it in `types.ts`, then code against the type.
2. **Run `/api/health` first** when the owner reports "X doesn't work". It reports ok/fail + a note for every upstream. Ask for that JSON and the `npm run dev` terminal output rather than guessing. A "Minified React error #441" in production is a server-component throw with the message stripped; reproduce with a fixture build or probe the upstream endpoints from Chrome (the sandbox and local VM cannot reach stonkfun.xyz).
3. **Server → client boundary:** never pass functions or class instances as props to `"use client"` components (Next throws at render). Use named-option props (`fmt="usd"`) as `charts.tsx` does.
4. **React Compiler lint is on** (`react-hooks/purity`, `react-hooks/immutability`). No `Date.now()` in components (use `nowMs()` from `format.ts`), no `let acc; arr.map(() => acc += …)` (use `cumulative()`). Run `npx eslint src` and `npx tsc --noEmit -p .` before every handoff; both must be clean.
5. **Verify the commit, not just the tree.** The mounted folder has dropped writes at least once (commit b9f5b4b was meant to carry the launches fix and contained only CLAUDE.md). After every commit run `git show --stat HEAD` and confirm every intended file is listed; if not, re-apply and recommit.
6. **Verify visually.** `DATA_SOURCE=fixture npx next build && DATA_SOURCE=fixture npx next start -p 3111`, then `CHROME_PATH=<chromium> node scripts/screenshot.mjs http://localhost:3111` and look at the PNGs. From a Cowork session the local VM cannot delete files in the mounted repo (so `next build` cannot clear `.next`) and each shell call is its own sandbox: copy `src public package*.json *.config.* tsconfig.json` to `$HOME/sf`, `npm ci` there, build, and start+curl in a single call. Tables must scroll inside their container (`.table-wrap`), never the page. Broken avatar images in fixture mode are expected (no network); live they load.
7. **Rate limits.** Home page ≈ 8 upstream requests; pairs page = 3; a full token walk = ~160 requests (16k tokens / 100). Keep `revalidate` windows; don't add per-row fetches.
8. **Dark theme only, by design.** The visual system is the "ledger" concept (2026-09-07, see the project doc `design-concept.md`): teal-black neutrals that share StonkFun's temperature (`--bg #0a1317`), a single teal accent (`--accent`) reserved for provenance links, nav and the ring mark, and a separate status set (`--up` bullish, `--caution`, `--neutral`, `--down`) that is never reused for chart series. Geist for prose, Geist Mono (`.num`, `.label`, `.src`) for every figure, address, endpoint and timestamp. Only leaf content is boxed (`.ind`, `.card`); groups are separated by rules, not nested cards. Signature marks: the tally bar (`TallyBar`, one segment per indicator, also on the OG card), the burn ring (`BurnRing`: nav mark, `icon.svg`, supply chart — the bite is the burned share), the state stripe on `.ind`, and the `Ticker` strip under the nav. Palette lives in `globals.css` (`--series-1..8` follow the validated dark-mode data-viz palette: blue, orange, aqua, yellow, magenta, green, violet, red). Categorical colors are assigned in fixed order, never cycled by rank. One y-axis per chart, no dual axes.
9. **Copy discipline.** Plain language, no hype adjectives, no "genuinely/honestly". Every metric tile has a one-line `sub` explaining what it is. Caveats live next to the number they qualify, not in a footer. Indicator `detail` is one sentence; the reasoning behind a threshold lives on /about, not in the cell. Never state the same figure twice on one page (the "−N% from peak" figure appeared five times before the 2026-09-07 copy pass).
10. **Rates need a real window.** The API pages at 100 and launches now exceed 100/hour, so "newest 100 tokens ÷ span" saturates (it showed a constant 100.0/h for days). Rates come from `platform_snapshots` deltas (`getLaunchVelocity`) when the DB is present; API-window fallbacks are labelled as estimates and never floor the span at 1h.
11. **Refresh cadence is stated where the number is.** Every `source` line names the provider in a few words plus its cache window (`StonkFun revenue · 30s`, `Raydium · 60s`, `stonk.fyi pool snapshots · 5 min`) — never endpoint paths or hostnames, chart headers carry their resolution, the nav pill says "updated Ns ago", and /about has the full "How fresh is this?" table. Keep those in sync when changing a `revalidate`.
12. **Icons go through `/api/icon?u=`.** Token images are hosted by creators on a long tail of gateways; `gateway.irys.xyz` (≈80% of them) went down on 2026-09-08 and blanked every table, on StonkFun's own site too. `TokenIcon` proxies through `/api/icon` (edge-cached a week on success, 5 min on failure) and falls back to initials on error. Never render a raw `<img>` for a token image.
13. **Not financial advice.** Keep the disclaimers that exist. The one exception to "no buy language" is the JTX affiliate button (owner's call 2026-09-10): `BuyButton` / `TradeLink` in `components/BuyButton.tsx`, URL built by `lib/jtx.ts` (`https://app.jtx.com/?mint=<mint>&ref=stonk`, `rel="sponsored"`). It sits in the nav (site-wide), the $STONK hero (large; no disclosure line under it — owner removed it 2026-09-10), the token detail header, in the full TokenTable as the "Buy" column where the Mode pill used to be (2026-09-11), and as a trailing "Trade" column in the compact TokenTable and the rewards, launches and holders tables. It is the only accent-filled element (`.btn-buy`); don't reuse that fill. `lib/jtx.ts` has no server-only imports because the Nav is a client component, so it carries its own copy of the STONK mint — keep it equal to `STONK_MINT` in `lib/api.ts`. Everything else keeps the no-buy-language rule.
14. **Commit hygiene** (if a repo is set up): conventional short messages; never commit `.env.local`; `next-env.d.ts` and `.next/` are generated.

---

## 6. Phase 2 — snapshot worker (running in production)

`GET /api/cron/snapshot` (auth: `Authorization: Bearer $CRON_SECRET`). Steps, each isolated so one failure doesn't stop the others: `platform` (stats+revenue → `platform_snapshots`, recent buybacks → `buybacks`), `revenue_daily`, `launches`, `stonk_burns` (→ `token_burns`), `burn_alert` (§6a), `burn_milestone` (§6c), `ath_alert` (§6d), `pool` (Raydium reserves → `pool_snapshots`), `rewards` (lifetime `distributedTokens` for the `YIELD_TRACKED`=200 largest reward coins by market cap → `reward_snapshots`, ~200 rows a tick; feeds `/yield`; in full mode also prunes untracked coins and readings older than 14 days), `holders` (the :30 tick and full mode only, §6e), `wallet_census` (every 6 h on the :45 tick or `?census=1`, §6f), `holder_profile` (STONK's HolderScan profile → `holderscan_snapshots`, §6h; every tick on the Advanced plan, every 6 h on Standard), `gmgn` (holder count, concentration, wallet tags, buy/sell volume → `gmgn_snapshots`; 0 rows when `GMGN_API_KEY` is unset), `tokens` (→ `tokens` + `token_snapshots`), and in full mode `prune`.

**Cadence is tiered to fit Supabase's 500 MB free tier** (the naive "every active token every 5 min" was ~1.7M rows/day and would have filled it in days):

| Mode | Who fires it | Tokens snapshotted |
|---|---|---|
| tick (default) | Supabase pg_cron `snapshot_tick` (`0004_pg_cron_tick.sql`), minutes 5–55 | STONK + top 100 by volume |
| `?hourly=1` | pg_cron `snapshot_hourly`, minute 0 | top 500 |
| `?full=1` | Vercel cron (`vercel.json`), daily 03:00 UTC | every page (~165 requests), then deletes non-STONK `token_snapshots` older than 30 days |

≈ 8 MB/day. STONK's own history is never pruned. `maxDuration = 300` (Fluid compute) so the full walk fits.

**Why pg_cron (2026-09-08):** Vercel's Hobby plan only allows daily cron, and GitHub Actions' `schedule:` turned out to be throttled on this repo — it fired every ~4 h (9 runs in the first 24 h), which froze the hourly fee revenue chart and every other DB-backed chart between runs. The tick now runs inside Supabase: `public.snapshot_tick(mode)` calls `/api/cron/snapshot` via `pg_net`, reading the bearer from Vault (`vault.decrypted_secrets` name `cron_secret`, same value as Vercel's `CRON_SECRET`; set it with `vault.create_secret(...)` **before** applying 0004, and update it there when rotating). **The GitHub↔Supabase integration did not apply 0004 on push** — it had to be pasted into the SQL editor by hand (applied 2026-09-08 19:43 UTC; first scheduled run 19:45:00, HTTP 200). Assume the same for future migrations. `snapshot.yml` is kept only for manual runs / as a coarse fallback; its repo secrets `SNAPSHOT_URL` and `CRON_SECRET` still exist. Check it: `select jobname, status, start_time from cron.job_run_details join cron.job using (jobid) order by start_time desc limit 10;` and `select status_code, created from net._http_response order by created desc limit 5;`.

**Schema:** `supabase/migrations/0001_init.sql`, with RLS enabled on every table (no policies → the anon/publishable key can read nothing; the site and worker use the service-role key, which bypasses RLS). Supabase's GitHub integration is also linked to the repo and may apply new files in `supabase/migrations/` on push to main — treat that as a convenience, not a guarantee; verify in the SQL editor.

**Verify it's alive:** `/api/health` → `supabase` check reports the `platform_snapshots` count and the age of the newest one, and **fails when it's older than 15 min** (a stalled tick is the first thing to suspect when any DB-backed chart stops moving); or in the Supabase SQL editor: `select ts, count(*) from token_snapshots group by ts order by ts desc limit 5;` — expect ~100 rows every 5 min, ~500 at the top of the hour. `gh run list --repo hankobaggins/stonk-fyi --workflow snapshot` shows tick results (the step fails on any non-200).

**What unlocks now that data accumulates:** real STONK price/mcap/volume charts on the token page (replace the "Price history" placeholder), burns-per-day over full history, buyback USD per day from the actual ledger instead of the revenue × share estimate, the net-flow indicator (after 12h), volume-by-pair over time, and STONK-quoted-token count over time.

## 6b — Holder-fee APR (`/tokens`, added 2026-09-09 as `/yield`, merged into the tokens page 2026-09-11)

The owner asked for a "largest yield-paying coins, 24h vs 3d APR" table like a third-party chart whose formula (volume × fee rate with assumed exclusions and an "operating fee") is not reproducible. The site instead shows a **realized** APR: `(Δ lifetime payout tokens over the window × quote USD price now) ÷ market cap now × (8760 ÷ hours covered)`. Payout deltas come from `reward_snapshots` via the `reward_payout_window(win_hours, mints)` SQL function (per requested mint: newest reading, and the newest reading at or before the window start, falling back to the earliest reading — three primary-key probes per mint, so it stays fast at any table size); a window is shown once readings cover ≥80% of it, else the cell says "collecting". Coins must be ≥72h old and have paid inside the 72h window; ranking is by market cap (top 100 reward coins by mcap from `/tokens?mode=reward`). `getRewardCoinsByMcap(n)` in `lib/yield.ts` is the one definition of "tracked coins", used by both the worker (n=200) and the page (n=100).

**Merged into `/tokens` (owner's call 2026-09-11):** every row of the token table carries the two APR columns (`getAprForTokens(tokens)`: one `reward_payout_window` call per window on the page's reward-mode mints, Jupiter prices for their quote assets, so ≤50 mints a request). A cell explains why it is empty: `standard` (pays nothing), `untracked` (reward coin outside the top-200 set, no readings), `collecting` (<80% window coverage), `unpriced`. **Column sorting (owner's ask 2026-09-11, "sort by all columns that matter"):** StonkFun sorts only by market cap / volume / newest, so the page loads a pool of the first `POOL`=500 tokens in the chosen API order that match the filters (first request gives the total; up to 4 more at 100 a page, all `revalidate` 30s), computes APR for the pool's reward coins (one `reward_payout_window` call per window on ≤500 mints; ≤200 have readings so PostgREST's 1,000-row cap is safe), then sorts and pages the pool itself. `sortTokens`/`SORT_KEYS` in `TokenTable.tsx`: mcap, price, chg, vol, ratio, apr1, apr3, age; nulls last in both directions; headers are links (`?by=&dir=`), `aria-sort` set, so the table stays a server component. When the match count exceeds the pool the subtitle and footer say sorting covers only those 500 — narrow the filters for the rest. `/tokens?mode=reward&by=apr3` is the old /yield ranking (no 72h age gate any more — young coins just read "collecting"); `/yield` redirects there. Nav label is "Tokens & yield". `getYieldTable()` (top 10 of the top 100 by mcap) is kept for `/yield-card` and the `reward_windows` health check.

**Post-mortem 2026-09-10 ("yield never populated").** 0005's worker step recorded every coin that paid in the last 7 days, sized from the fixture (193 launches → "~50 rows a tick"). Live that was 5,328 coins a tick: 1,216,672 rows / 333 MB in 21.5 h, and the unscoped `reward_payout_window(win_hours)` (three full `DISTINCT ON` sorts) stopped finishing inside the API's 8 s statement timeout (its result, 5,376 rows, would also have exceeded PostgREST's 1,000-row cap). `getRewardWindows` swallowed the error and returned null, so the page said "collecting: under an hour" while `/api/health` happily reported 21.5 h of history. Fixes: scoped tracking + scoped function (0006), the RPC error is now logged and shown as its own page state (`db-error`), and `/api/health` → `reward_windows` makes the exact call the page makes. Lesson for every worker step: size the row count from the live endpoint, not the fixture, and give every DB read the page depends on a health check that runs the same query. Quote prices: Jupiter, STONK at StonkFun's price. Market cap is the denominator (understates yield on eligible balance — said on the page and on /about#yield). The whole table is empty until ~20h of readings exist and the 3d column until ~58h. `/api/health` → `reward_snapshots` shows staleness of the newest reading (error = 0005 missing or the step stalled) and `reward_windows` runs the page's own window query on the top-100 mints (error = 0006 missing or a timeout).

## 6a — Big-burn alerts → X (added 2026-09-08)

**Rule:** if STONK burns inside the last hour (`BURN_ALERT_WINDOW_MIN`=60), minus burns already announced, are worth ≥ **$120,000** at StonkFun's value-at-burn (`BURN_ALERT_THRESHOLD_USD`; USD, not tokens; owner's call 2026-09-11 — was $10K / 10 min from 2026-09-08 and $50K / 10 min before that), the worker posts a card to X. Runs as the `burn_alert` step of every tick. Detection slides a 60-min window over every burn the API returns (~25 most recent), not just the last hour, so a late tick still catches a window that already closed; announced signatures are excluded so nothing is double-counted. ~~Known problem (2026-09-08): GitHub's `*/5` schedule fired ~every 4–5 hours, which is why a $20K window went unannounced.~~ Fixed the same day by moving the tick to Supabase pg_cron (§6).

**Pipeline (`src/lib/burn-alerts.ts` → `runBurnAlert`)**
1. `getStonkData()` (live burns window, supply %, burn-velocity indicator, price).
2. `findBigBurnWindow()` (`src/lib/burn-window.ts`, pure) with `exclude` = signatures already in `burn_alert_signatures`.
3. Insert a `burn_alerts` row (status `pending` or `dry_run`) and claim the signatures **before** posting, so a concurrent tick can't announce them twice.
4. Card URL = `https://stonk.fyi/burn-card/{id}` — rendered by `next/og` from the stored row, so the image is reproducible and stays as provenance.
5. SocialBu REST: `POST /upload_media_by_url {url, name}` → `upload_token`; `POST /posts {content, accounts:[SOCIALBU_ACCOUNT_ID], publish_at: now UTC, existing_attachments:[{upload_token}]}`. Base `https://socialbu.com/api/v1`, `Authorization: Bearer $SOCIALBU_TOKEN` (Settings → API for Developers). Success → status `posted` + `socialbu_post_id`; failure → `failed` + `error` (signatures stay claimed; re-post by hand if it matters).

**Card content** (`src/app/burn-card/[id]/route.tsx`): exact amount (not "300K+"), tx count and sources, USD at StonkFun pricing (labelled), total supply burned as the burn ring, burn velocity with its real scorecard state (bullish / neutral / caution / unscored — never a hard-coded "Bullish"), largest tx short sig, UTC timestamp, the provenance footer and "not financial advice". Tweet text is two plain sentences with no links (owner's call, 2026-09-08): amount / txs / USD, then supply burned % and velocity (`buildPostText`).

**Ops**
- Env: `SOCIALBU_TOKEN`, `SOCIALBU_ACCOUNT_ID=201802` (the stonk.fyi X account in SocialBu; `StickPicker` is 201510 — don't mix them up). Unset → the step still records alerts as `dry_run` with a card URL, nothing is posted. `?dry=1` on the cron URL forces that.
- Migration `supabase/migrations/0003_burn_alerts.sql` must be applied before the step can write.
- `/api/health` → `burn_alerts` check shows threshold, posting vs dry-run mode, and the last alert. `/burn-card/preview` renders the card from the newest burns regardless of threshold.
- The worker step is isolated like the others: a SocialBu outage fails only `burn_alert`, not the snapshot.
- Once real STONK-burn history is in `token_burns`, consider a daily "burned today" card on the same rail (roadmap #6).

## 6c — Burn milestones → X (added 2026-09-10)

**Rule:** every whole percent of the fixed 1B supply burned (13%, 14%, …) gets one card posted to X. Runs as the `burn_milestone` step of every tick, right after `burn_alert`, on the same `getStonkData()` read (lifetime burned share from `/tokens/{mint}/burns` totals). Step size is hard-coded at 1% (`MILESTONE_STEP_PCT` in `milestone-math.ts`; owner's call 2026-09-10).

**Pipeline (`src/lib/burn-milestones.ts` → `runBurnMilestone`)**
1. `latestMilestone()` = highest `pct` in `burn_milestones`. **Empty table → seed** one row at the current floor with status `seeded`, post nothing. So turning the feature on never replays old milestones; the first tweet is the next whole percent.
2. `newMilestones(current, last)` = every whole percent in (last, floor(current)]. Normally one. If the worker was down long enough to skip several, only the highest gets a card; the ones below are inserted as `skipped` so the ledger stays contiguous (and "last 1% took" is left blank for that post).
3. `findCrossing()` walks the ~25 recent burns newest-first, subtracting from the lifetime total, to find the tx that crossed the line (`reached_at`, `crossing_signature`); null when the crossing predates the window — then the card stamps detection time.
4. Insert the row (**pct is the primary key, so a concurrent tick's insert fails instead of double-posting**) with `card_url = https://stonk.fyi/milestone-card/{pct}`, then `postCardToX()` (shared with §6a, in `burn-alerts.ts`). Status `posted` / `failed` / `dry_run` as in §6a.

**Card** (`lib/milestone-card.tsx`, square): no badge or subtitle row (owner's call 2026-09-10); the whole percent as the headline, the burn ring at 300px (bite = burned share), tokens burned and days since launch, then 2×2: tokens burned, lifetime USD at burn (StonkFun pricing, labelled), "last 1% took" (from the previous row's `reached_at`; "first tracked" when unknown), burn velocity with its real scorecard state and "next 1% in ~N days" at that pace in the label. Tweet (`buildMilestoneText`): two plain sentences, no links — `14% of $STONK supply is now burned: 140,012,345 tokens, about $2.1M at StonkFun pricing, 49 days after launch.` / `The last 1% took 4.2 days. Burn velocity 0.31%/day.`

**Ops**
- Same env as §6a (`SOCIALBU_TOKEN`, `SOCIALBU_ACCOUNT_ID`); unset or `?dry=1` → `dry_run` rows with a card URL, nothing posted.
- **Migration `0007_burn_milestones.sql` must be pasted into the SQL editor by hand before the step can write**; until then the step fails (isolated, the rest of the tick is unaffected) and `/api/health` → `burn_milestones` reports the error.
- `/api/health` → `burn_milestones`: mode, last row (`13% seeded at …`), and the next percent that will post. Tick response `notes.burn_milestone` says `14% posted` (or `dry_run`, plus any skipped).
- Re-post by hand: the card at `/milestone-card/{pct}` is reproducible from the stored row; `seeded` and `skipped` rows 404 there.

## 6d — All-time-high alerts → X (added 2026-09-10)

**Rule:** when $STONK's market cap (USD, StonkFun pricing) breaks its previous all-time high, a card is posted to X. "Previous ATH" is the highest figure ever recorded in `ath_alerts`, seeded on the first run from StonkFun's `peakMarketCapUsd`, so the first tweet is a real new high and never a replay. Runs as the `ath_alert` step of every tick, after `burn_milestone`, on the same `getStonkData()` read.

**Throttle (owner's call 2026-09-10: cooldown only, no minimum gain):** at most one post per `ATH_ALERT_COOLDOWN_MIN` (default 60). A new high inside the cooldown is still recorded (status `quiet`) and raises the bar, so the next post needs a high above it after the cooldown. Consequence: a spike that peaks and fades inside the cooldown is never announced — the alternative (tweeting a stale figure once the cooldown ends) would be wrong.

**Pipeline (`src/lib/ath-alerts.ts` → `runAthAlert`, pure math in `ath-math.ts`)**
1. Candidate = the higher of live `marketCapUsd` and StonkFun's `peakMarketCapUsd` (`athCandidate`; their peak can lag a tick, live can beat it). `source` records which one.
2. `evaluateAth(candidate, highestAth, lastPostAt, now)`: `newHigh` when candidate > the highest row (any status); `announce` when the cooldown since the newest posted/pending/dry_run row has elapsed (failed rows don't count, so the next high retries).
3. Empty table → insert `seeded`, post nothing. Not a new high → nothing. New high in cooldown → `quiet` row. Otherwise insert `pending`/`dry_run` first (**unique index on `market_cap_usd`: a concurrent tick inserting the same figure fails instead of double-posting**), set `card_url = https://stonk.fyi/ath-card/{id}`, then `postCardToX()` (shared with §6a/§6c). Status `posted` / `failed` as in §6a.

**Card** (`lib/ath-card.tsx`, the existing square ATH card with an optional `prevHighUsd`): headline = the new high, sub-line "previous high $X (+Y%)", then price now, 24h change, peak vs launch, supply burned. Tweet (`buildAthText`): `New $STONK all-time high: $191.24M market cap at StonkFun pricing, +2.9% over the previous high of $185.94M set 2026-09-09.` / `Price $0.2214 (+18.3% 24h). 13.41% of supply burned.` Gains under 0.05% read "just above the previous high". Offline sample render: `Claude outputs/render-ath-card-sample.tsx` (copy to the repo root, `npx tsx --tsconfig tsconfig.json`).

**Ops**
- Env: `SOCIALBU_TOKEN`, `SOCIALBU_ACCOUNT_ID` as §6a (unset or `?dry=1` → `dry_run` rows, nothing posted); `ATH_ALERT_COOLDOWN_MIN` optional.
- **Migration `0008_ath_alerts.sql` must be pasted into the SQL editor by hand**; until then the step fails (isolated) and `/api/health` → `ath_alerts` reports the error. The first tick after that seeds the bar; check it says `seeded` at StonkFun's peak before trusting the feature.
- `/api/health` → `ath_alerts`: mode, cooldown, the bar (highest row, its status and source) and the last post. Tick response `notes.ath_alert` says `#12 posted at $191,240,000` (or `quiet` / `seeded` / `dry_run`).
- Re-post by hand: `/ath-card/{id}` is reproducible from the row. Price ATH is deliberately not tracked (burns let price hit a high while market cap does not; owner chose market cap 2026-09-10).

## 6e — Holders of stock-quoted assets (`/holders`, added 2026-09-10)

Owner asked for unique holders, with 24h and 1-week change, for "stocks + Backpack quoted assets". Scope settled 2026-09-10: both the quote assets themselves and the coins launched against them; categories `xstock`, `prestock`, `tessera`, `backpack` (StonkFun's `/pairs` tags; 24 + 7 + 2 + 47 = 80 mints live); holder source GMGN; own page.

**Two counts, two providers, stated on the page as not comparable:**
- *Quote assets* — GMGN `/v1/token/info` `holder_count` (every wallet with a balance, all venues), one weight-1 call per mint (`getGmgnHolderCount` in `gmgn.ts`, no cache). GMGN has no batch route. Quote assets GMGN does not index show "no reading" and are counted in the tick note.
- *Coins* — the `HOLDERS_TRACKED`=100 largest **reward-mode** coins by market cap across the four categories (`getStockCoinsByMcap`: one `/tokens?mode=reward&category=X&sort=marketCap` page per category, merged), holder count = StonkFun's `holderCount` in `/rewards` (one call, reward-eligible wallets). Standard-mode coins have no holder figure in the API and are not listed (live: ~19.5K coins in these categories, ~15.4K reward-mode).

**Cadence:** the `holders` worker step runs once an hour on the **:30 tick** (minute 30–34; and in `?full=1`), not the hourly run, so its ~2 min of paced GMGN calls do not sit on top of the 500-token walk (~180 rows an hour → `holder_snapshots`). **GMGN pacing (2026-09-10):** the first run, 3 calls in flight with a 150 ms gap, got 6 answers out of 80 (the first two of each provider group) before every call 429'd — the free plan throttles far below the documented 20/s. Now one call at a time, 1.2 s apart, with 429 retries after 4/12/30 s. If coverage on `/api/health` → `holder_windows` still reads well under 80/80, slow it further before anything else. Full mode also prunes untracked mints and readings older than `HOLDERS_RETENTION_DAYS`=14 via `holder_snapshots_prune`. Sized from the live endpoints (0005 lesson). Windows come from `holder_window(win_hours, mints)` (three PK probes per mint, same shape as 0006); a column shows once readings cover ≥80% of the window — 24h after ~20 h, 7d after ~5.5 days.

**Ops:** migration `0009_holder_snapshots.sql` must be pasted into the SQL editor by hand; until then the step fails (isolated) and `/api/health` → `holder_snapshots` reports the error. `/api/health` → `holder_snapshots` (staleness; fails past 75 min) and `holder_windows` (the page's exact query on the tracked mints; coverage + hours of history). Tick response `notes.holders` = `78 quote assets read, 2 failed (SYM: <first error>), 100 coins`. Page states: `no-db`, `db-error`, `collecting` (no readings at all), `ok`. **Layout (owner's call 2026-09-10):** one combined table, `components/HoldersTable.tsx` (client): a Kind filter (All / Quote assets / Coins), an Issuer filter (All / xStocks / Backpack / Pre-stocks / Tessera — chips derived from the rows) and click-to-sort headers (asset, provider, holders, 24h, 7d, market cap; nulls last; default holders desc). The page hands it plain rows (`HolderRow`), never functions. Above it, four `.kpis` tiles, one per issuer: tracked-coin market cap (headline), tracked-coin count and StonkFun holders with the summed 24h change once readings exist, and GMGN holders summed over the quote assets that have a reading — coin and quote-asset holder sums are never added together. The "two providers, not comparable" caveat sits under the table.

## 6f — Wallet census: unique wallets holding any quote asset (`/holders`, added 2026-09-11)

**Owner's ask (first priority):** the number of distinct wallets that hold at least one stock-quoted quote asset, with 24h / 7d / 30d change — one address holding both ZEC-x and TAO-x counts once — and (second) a multi-select issuer filter so stocks (xStocks + Backpack) can be separated from pre-IPO (Pre-stocks + Tessera). Neither StonkFun nor GMGN exposes wallet lists, so this is the first on-chain step (Phase 3), via **Helius DAS `getTokenAccounts`** (`src/lib/helius.ts`: `mint` + `limit 1000` + cursor, `showZeroBalance:false`; paced at 550 ms between calls for the free plan's 2 DAS req/s; 10 credits a page).

**Design (`src/lib/wallets.ts` → `runWalletCensus`):** for each of the ~80 quote assets, every token account with a non-zero balance → owner; per owner, a 4-bit mask of the issuer categories held (bit = index in `STOCK_CATEGORIES`: 1 xstock, 2 backpack, 4 prestock, 8 tessera). Stored as a **15-row histogram per run** (`wallet_runs(ts, mask, wallets)`), never an address — any issuer subset is answered client-side as Σ wallets where `mask & subset ≠ 0` (`WalletCensus.tsx`). Also written: `wallet_mint_counts(mint, ts, category, owners, accounts)` — the on-chain owner count per quote asset from the same pull, kept apart from GMGN's `holder_snapshots` — and `wallet_run_meta` (mints ok/failed, first error, accounts, duration). A run with failed mints is stored and flagged as incomplete on the page (it undercounts). Migration `0010_wallet_census.sql`, by hand as usual.

**Cadence:** every `WALLET_CENSUS_EVERY_H` (default 6) hours on the **:45 tick** (`censusDue`), or on demand with `?census=1` on the cron URL. Budget at launch: ~80 mints, a few hundred pages a run (APPLX alone is ~33), ≈3K credits a run → ≈12K/day, well inside Helius's 1M/month free tier. If a mint ever exceeds `maxPages`=100 (100K token accounts) the count is truncated — raise the guard then.

**Own route (2026-09-11 post-mortem):** the first live run, inline in the tick, did not fit: the GitHub workflow's curl timed out at 280 s with nothing stored (the whole function is capped at 300 s and the other steps had already used part of it; the "2–3 min" estimate was from the docs, not a live pull). The census now lives in **`/api/cron/census`** (`src/app/api/cron/census/route.ts`, `maxDuration = 800` — Vercel Pro + Fluid compute; Hobby caps at 300): plain `GET` answers **202 at once** and does the work in `after()` with a `CENSUS_BUDGET_MS` = 720 s budget; when the budget runs out the remaining mints count as failed and the partial run is stored and flagged incomplete, never lost. `?sync=1` waits and returns the result (the GitHub workflow's "census" checkbox uses it, `--max-time 840`). The tick only *kicks it off* (a 20 s fetch with the bearer, `notes.wallet_census = started /api/cron/census …`); the result lands in `wallet_run_meta` and `/api/health` → `wallet_census`. Watch `duration_ms` on the first runs: if it sits near the budget, lower the Helius pacing (`GAP_MS`) before anything else.

**Page:** the "Unique wallets holding at least one quote asset" block at the top of `/holders`: presets (All / Stocks / Pre-IPO) + four issuer toggles (never empty), tiles for the current count and 24h / 7d / 30d change (a window shows once runs cover ≥80% of it: ~1, ~6 and ~24 days), an area chart of the selected subset over the last 31 days, and the run's coverage line. Caveat on the page: program-owned accounts (pool vaults) are counted like any owner — nothing on-chain marks them apart.

**Ops:** env `HELIUS_API_KEY` (free key at dashboard.helius.dev; `HELIUS_RPC_URL` optional). Unset → `/api/cron/census` answers 503 and the tick's `wallet_census` step fails in isolation. `/api/health` → `wallet_census`: key present?, last run age (fails past 1.5 × the cadence), wallets, mints ok/failed + first error. The census route logs `wallet census <ts>: 31234 wallets across 80 quote assets, 61234 accounts, 143s` (Vercel → Logs, path `/api/cron/census`). **First-run check:** after adding the key and 0010, run the GitHub `snapshot` workflow with the census box ticked (or `GET /api/cron/census?sync=1` with the bearer) or wait for the next :45 slot, then confirm `mints_failed` = 0 in `wallet_run_meta` — the `getTokenAccounts`-by-mint shape was taken from Helius docs, not verified live from this sandbox (it cannot reach Helius).

**Follow-up (owner's ask, third):** holder count by quote asset over time — `wallet_mint_counts` already accumulates it from the same runs; needs a per-asset sparkline/chart on the page.

## 6g — The whole universe: HolderScan holder counts + reward-coin wallet census (`/holders`, added 2026-09-12)

**Owner's ask (2026-09-12):** extend /holders from the four stock categories to every quote-asset category, and lead with the story that the StonkFun ecosystem is adding holders across the whole universe of quote tokens — then show each project what the ecosystem does for it. Decisions: universe = quote assets with ≥1 reward-mode coin launched against them; HolderScan (owner bought Premium → Standard API plan) read once a day over the universe; the headline is the **de-duplicated on-chain count of wallets holding a reward coin**, not a sum of anyone's holder counts; everything on /holders, the stock-only hourly blocks (§6e/§6f) kept below. Spec: project doc `claude/universe-holders-spec.md`.

**Universe (`lib/universe.ts` → `getUniverse()`):** `/pairs` joined with `/rewards` launches; only pairs with ≥1 reward launch (317 of 484 pairs live on 2026-09-12: custom 391 → "Crypto", backpack 49, xstock 24, prestock 7, currency 5 → "Stablecoins", tessera 2, leverage 2, solana 2, collectible 2). Quote mints the rewards ledger knows but /pairs no longer lists are kept as category `other`. `slots` = Σ StonkFun `holderCount` over the asset's coins (1.04M in total; one slot per coin per wallet, not distinct wallets).

**Two readings, two tables, never added:**
- *Holders* — HolderScan `GET /v0/sol/tokens/{mint}/holders?limit=1` → `holder_count` (`lib/holderscan.ts`, header `x-api-key`, 10 request units a call, paced 250 ms under the 300/min limit, 429 retries). Worker step `universe_holders`, **once a day on the 02:15 UTC tick** (`universeDue`; or `?universe=1`; its own slot, ~320 calls ≈ 80 s) → `quote_holder_snapshots` (migration 0011), `quote_holder_window(win_hours, mints)` (same three-probe shape as 0009), pruned to `UNIVERSE_RETENTION_DAYS`=60. 24h / 7d / 30d columns once readings cover ≥80% of the window. 404 = not tracked by HolderScan → "no reading", never zero. Budget: ~96K of the Standard plan's 200K units a month; hourly needs the Advanced plan ($149/mo, 15M units). Skipped with a note when `HOLDERSCAN_API_KEY` is unset. **Backfill for the 7d / 30d columns (owner's ask 2026-09-12, "can't wait 30 days"):** step `universe_deltas` reads HolderScan's own `/holders/deltas` (`{7days,14days,30days}`, 20 units a call, no 24h figure exists) every `UNIVERSE_DELTAS_EVERY_DAYS`=3 days on the same 02:15 tick (`deltasDue`; or `?deltas=1`) → `quote_holder_deltas` (migration 0012). `getUniverseTable` uses a delta only where this site's own window is not yet covered (`deltaChange`, `provider: "holderscan"`, an "HS" mark in the cell); the 24h column never comes from HolderScan. The census columns have no backfill — nobody holds yesterday's on-chain answer — and must not be faked. **The one backdated ecosystem-growth figure** (owner: "the most important metric") is step `coin_deltas`: HolderScan deltas for the `COIN_DELTAS_TOP`=250 largest reward coins by holderCount → `coin_holder_deltas` (migration 0013), summed on the page as "Holders added to StonkFun coins" in holder-slots (7/14/30d) with the coverage stated; same cadence as the quote-asset deltas (`DELTAS_EVERY_DAYS` now defaults to 4 so counts + both delta steps fit the 200K-unit plan: ~96K + ~47K + ~37K), or `?coindeltas=1[&top=N]`.
- *StonkFun wallets* — `runCoinCensus` in `lib/wallets.ts`, run by **`/api/cron/census?kind=coins`** (same route and 720 s budget as §6f), kicked off by the tick **daily at 01:15 UTC** (`coinCensusDue`; or `?census=coins` on the snapshot URL, or the workflow's `coin_census` box). A full walk of all 11,768 reward coins would be ~12K Helius pages (~2 h at the free plan's 550 ms gap), so `pickCoinsForCensus` takes coins largest-first by StonkFun `holderCount` until the estimated page count reaches `COIN_CENSUS_MAX_PAGES` (env, default 1100 ≈ the top ~450 coins, ~70% of holder-slots, ~10 min, ~11K credits a run). Owners are de-duplicated in memory three ways — overall, per quote asset, per quote-asset category — and only counts are stored: `coin_census_runs`, `coin_census_quotes`, `coin_census_categories` (0011). **The figure is a lower bound and the page says so**, with the coverage line. **Paid Helius (owner upgrading 2026-09-12):** set `HELIUS_PLAN=developer` (any value but `free`) → DAS paced 100 ms, `COIN_CENSUS_MAX_PAGES` 3,000 (~90% of holder-slots, ~5 min, ~30K credits a run) and `COIN_CENSUS_EVERY_H` 6 (01/07/13/19:15 UTC; ≈3.6M credits a month of the Developer plan's 10M). `HELIUS_GAP_MS`, `COIN_CENSUS_MAX_PAGES`, `COIN_CENSUS_EVERY_H` override individually. The chart in the ecosystem block draws from the second run (a one-run placeholder says when the next is due); the 24h/7d/30d tiles round up to the next run at the configured cadence. `/api/health` → `coin_census` fails past 1.5× the cadence.

**Page:** headline block `EcosystemWallets.tsx` (count, 24h/7d/30d, 31-day area chart, coverage line), category tiles (StonkFun wallets de-duplicated within the category + 24h, assets / coins / holder-slots), then `UniverseTable.tsx` over every universe asset: HolderScan holders + 24h/7d/30d, StonkFun wallets + 24h, share (= wallets ÷ holders — the per-project impact figure), coins, read age; presets All / Stocks / Pre-IPO / Crypto plus per-category toggles (never empty), sortable headers. A "+" after a StonkFun-wallets figure marks an asset whose smaller coins fell outside the census budget. Category sums are stated as over-counting across categories; the headline is the only cross-category figure.

**Ops:** env `HOLDERSCAN_API_KEY` (dashboard at holderscan.com/account); migration `0011_universe_holders.sql` by hand. `/api/health` → `universe_holders` (key present, assets with a reading, newest age — fails past 36 h) and `coin_census` (last run age — fails past 36 h —, wallets, coins covered / total, % of slots, duration, failures). **First-run checks:** how many of the ~320 assets HolderScan answers for (the API is beta with a "supported tokens" list — small custom quote assets may 404), and the coin census `duration_ms` against the 720 s budget (lower `COIN_CENSUS_MAX_PAGES` if it hits the budget; it stores a partial, flagged run rather than nothing). Neither the sandbox nor the local VM can reach api.holderscan.com or Helius; verify from production.

## 6h — HolderScan holder profiles: the $STONK holder base, avg $ per holder, provider switch (added 2026-09-12)

**Owner's ask (2026-09-12, HolderScan API live):** use HolderScan for every applicable holder figure, add the average $ held per holder, and whatever else helps someone tracking STONK's bullish metrics. Owner chose the **Advanced plan ($149/mo, 15M units, 1000/min)** — set `HOLDERSCAN_PLAN=advanced` in Vercel once it is active; until then every cadence below runs at its Standard-plan setting and the whole site fits the 200K-unit plan.

**Routes (docs.holderscan.com/api/endpoints, verified 2026-09-12; costs in request units):** `holders?limit=N` 10 (holder_count + top holders, top 1000 at most, amounts in whole tokens), `holders/deltas` 20 (**now 1h / 2h / 4h / 12h / 1d / 3d / 7d / 14d / 30d** — the short windows are new; the client reads them all), `holders/breakdowns` 50 (holders over $10 / $100 / $1K / $10K / $100K / $1M at HolderScan's valuation + shrimp / crab / fish / dolphin / whale), `stats` 20 (hhi, gini, median_holder_position in whole tokens, avg_time_held seconds, retention_rate — the last two null for unprofiled tokens), `stats/pnl` 20 (break_even_price, realized / unrealized PnL USD, FIFO), `stats/wallet-categories` 20 (top-1000 wallets by hold-time class diamond / gold / silver / bronze / wood / new), `stats/supply-breakdown` 20 (the same wallets' holdings by class), `tokens/{mint}` 10 (decimals, raw supply). No CEX-holdings route in the API (the website has one). STONK is tracked (holderscan.com/token/<mint>: 65,693 holders on 2026-09-12, matching GMGN's 65,703). Client: `lib/holderscan.ts` (`read()` helper: 404 = not tracked, other non-200 = error, 200 with the wrong shape = "unexpected shape"; `lastHolderscanError` for health). Pacing `HOLDERSCAN_GAP_MS` defaults 250 ms (Standard) / 100 ms (Advanced).

**STONK profile (`lib/stonk-holders.ts`, worker step `holder_profile`, migration 0014 `holderscan_snapshots`):** one read = the seven routes above (150 units) → one row keyed (mint, ts) with everything, plus `top10_share` / `top100_share` = Σ top-N amounts ÷ circulating supply (null if the sum exceeds the supply, i.e. the mint answered in raw units — check `/api/health` → holder_profile on the first live read). **Cadence:** every tick on Advanced (≈1.3M units/month), every 6 h on the :20 tick (02/08/14/20:20 UTC) on Standard; `?profile=1` forces one. `holderscan_series(mint, since)` gives an hourly series for the charts; `getHolderHistory()` returns the newest row, the rows ≥19h / ≥5.6d before it, the 30-day series and hours of history. Pruned to `HOLDERSCAN_RETENTION_DAYS`=90 by the full run. The page never calls HolderScan; without a DB (previews) the block and the four cells are absent. `DATA_SOURCE=fixture` serves `src/fixtures/holderscan-stonk.json` — **a synthetic sample in the HolderHistory shape** (counts from HolderScan's public STONK page, tiers from the docs' example), not a live capture: neither the sandbox nor the local VM reaches api.holderscan.com. Replace it with a real row once one exists.

**Home page:** KPI tile "Average per holder" = StonkFun market cap ÷ HolderScan holders, with the median position (HolderScan's, × StonkFun price) beside it — the median is the honest "typical holder"; the average is what a few large wallets and the pools make it. Block `components/HolderBase.tsx` after the scorecard: holders with HolderScan's 1h / 24h / 7d / 30d, average and median per holder, holders over $1K (24h change between this site's readings), average hold time + retention, the $10…$1M ladder with share and 24h change, size tiers and hold-time classes (ShareBar), top-10 / top-100 share, Gini, HHI, break-even (× vs price), unrealized / realized PnL, "missing on this read" if a route failed, and two hourly charts (holders, holders over $1K). The hero's GMGN line drops its holder count when the block is present (rule 9).

**Scorecard (`holderscanIndicators` in `lib/stonk.ts`, group "holders"):** `holders` — HolderScan count, scored on HolderScan's own 24h change (> +0.5% bull, ±0.5% neutral), so no 12h wait; GMGN's `holders` cell is skipped when it exists (`gmgnIndicators(…, holdersCovered)`) and returns when HolderScan is unavailable. `holders1k` — holders over $1K, scored on the 24h change between readings (>+0.5% / ±0.5%), "collecting" until a row ≥19h old exists. `diamond` — diamond-class share of the top-1000 wallets' supply (≥50% bull, ≥25% neutral — first guesses on one day of data; revisit). `breakeven` — price ÷ aggregate break-even, context only (above 1× is both a healthy base and latent sell pressure). GMGN keeps top-10 concentration, buy share and smart money. Thresholds are on /about (#holderbase).

**Tokens page:** two sortable columns on the full table, `holders` (StonkFun's reward-eligible holderCount from one `/rewards` call, "standard" for standard coins) and `avg` = market cap ÷ holders (`avgPerHolder` in TokenTable.tsx; `sortTokens` takes the holders map). Token detail: "Avg per holder" mini in the Holder rewards section (mcap ÷ holders paid, with the pool-supply caveat) and HolderScan's 24h / 7d / 14d / 30d holder change when `coin_holder_deltas` has a row for the mint (`getCoinHolderDelta`).

**/holders provider switch:** the hourly `holders` step reads the ~83 stock quote assets from HolderScan when the key is set (GMGN per mint only for a 404, stored with `source`), and `holder_window()` (redefined in 0014) only compares readings of the same source as the newest, so the switch shows no step; the page names the provider from the newest readings (`quoteSource`). Universe counts run **hourly on Advanced** (`UNIVERSE_EVERY_H`, :15 tick every hour; ≈2.3M units/month) and daily on Standard; HolderScan deltas **daily on Advanced** (`UNIVERSE_DELTAS_EVERY_DAYS`), and both delta tables now store `d1` / `d3`, so the 24h column is backfilled from HolderScan's 1-day figure (HS mark) when read in the last 36 h. `coin_deltas` health note carries the 24h sum.

**Ops:** `HOLDERSCAN_PLAN=advanced` (cadences + pacing), `HOLDERSCAN_RETENTION_DAYS`. Migration `0014_holderscan_profiles.sql` by hand (table, prune + series functions, d1/d3 columns, holder_window redefinition). `/api/health` → `holder_profile` (plan, newest row's headline figures, age — fails past 3× the cadence, days of history, missing routes, last HolderScan error), `holder_snapshots` now names the provider of the newest quote-asset reading, `universe_holders` states the cadence and fails past 2× it when hourly. **First-run checks:** top-10 share is a sane figure (≈17–18%, matching GMGN's 18.1%) — if null, HolderScan answered in raw units and `readHolderProfile` needs a decimals divide; which of the seven routes STONK answers (`stats` avg_time_held / retention and `pnl` are "not available for all tokens"); the tick's `notes.holder_profile`. Budget on Advanced ≈ 4.7M of 15M units a month (STONK 1.3M, universe hourly 2.3M, stock hourly 0.6M, deltas 0.35M); on Standard ≈ 190K of 200K.

## 7. Roadmap (in priority order)

1. ~~Deploy to Vercel + turn on Supabase worker~~ — done 2026-09-07.
2. ~~Wire DB-backed charts~~ Done 2026-09-08 for token detail (`TokenHistoryChart`, 7d, `getTokenHistory`) and platform revenue pace (`getRevenuePace`) and launch velocity (`getLaunchVelocity`). Still open: STONK home price chart from snapshots instead of CoinGecko; the daily volume chart. Original note: wire DB-backed charts into the STONK page and token detail; add a `getStonkHistory()` in `db.ts` reading `token_snapshots` for `STONK_MINT`.
3. ~~**Independent price check**~~ — done via GMGN (Orca STONK/SOL pool price, spread under the hero price). Jupiter/DexScreener would add a second independent source.
4. **Phase 3 on-chain (Helius):** started 2026-09-11 with the wallet census (§6f). ~~holder count & top-holder concentration~~ (now via GMGN; Helius would make them first-party), unique traders/day, on-chain verification of burn totals against the mint's supply, pool liquidity distribution around the current tick (would make the projection ceiling realistic).
5. **Public-site polish:** ~~OG image / social card, `robots.txt`, sitemap, `/about` page, mobile pass, favicon, visual redesign (ledger concept)~~ done. Remaining: analytics (Vercel Web Analytics is one click in the dashboard).
6. **Yield:** `/yield` is live-computed; once a week of `reward_snapshots` exists, consider a 7d column and a per-coin payout sparkline on the token page.
7. **Holders (§6e, §6f, §6g, §6h):** HolderScan profiles shipped 2026-09-12 (§6h) — next on that rail: profile the largest reward coins too (the table is keyed by mint), a "holders added, 7d" ranking from HolderScan's deltas, revisit the diamond / $1K thresholds after a month. The ecosystem view shipped 2026-09-12 (§6g); once a week of daily readings exists, add the per-asset "holders added, 7d" ranking and a "StonkFun wallets vs holders" chart per asset. Earlier ask — holder count by quote asset over time (`wallet_mint_counts` is accumulating it; build the per-asset chart). Then per-asset sparklines in the table and a "holders added, 7d" ranking.
8. **Alerts:** ~~big-burn card to X~~ (done 2026-09-08, §6a). ~~Burn milestones (every 1% of supply)~~ done 2026-09-10, §6c. ~~All-time-high market cap~~ done 2026-09-10, §6d. Next on the same rail: indicator flips, daily revenue records. `/buyback-card?hours=1` (2026-09-09) and `/yield-card` (2026-09-10) are hand-posted cards for now; an hourly or daily "who paid for the buybacks" post could reuse it.

---

## 8. Environment

```
DATA_SOURCE=live | fixture          # fixture = offline dev on captured JSON
STONKFUN_API_BASE                   # override, default https://www.stonkfun.xyz/api/public/v1
RAYDIUM_API_BASE                    # override, default https://api-v3.raydium.io
COINGECKO_STONK_ID=stonk-3          # optional; COINGECKO_API_KEY optional demo key
GMGN_API_KEY                        # optional; enables the Holders & flow section + gmgn worker step
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET   # Phase 2 only
SOCIALBU_TOKEN, SOCIALBU_ACCOUNT_ID=201802             # big-burn alerts to X (§6a); unset = dry run
BURN_ALERT_THRESHOLD_USD=120000, BURN_ALERT_WINDOW_MIN=60  # optional overrides (USD at burn)
HELIUS_API_KEY, WALLET_CENSUS_EVERY_H=6                # wallet census (§6f); HELIUS_RPC_URL optional override; HELIUS_GAP_MS=550 pacing
HELIUS_PLAN=free|developer                             # §6g: paid = 100 ms DAS pacing, coin census every 6 h with 3,000 pages (COIN_CENSUS_EVERY_H / COIN_CENSUS_MAX_PAGES override)
HOLDERSCAN_API_KEY, COIN_CENSUS_MAX_PAGES=1100         # universe holders + reward-coin census (§6g); HOLDERSCAN_GAP_MS, UNIVERSE_DELTAS_EVERY_DAYS, UNIVERSE_EVERY_H, COIN_DELTAS_TOP=250 optional
HOLDERSCAN_PLAN=standard|advanced                      # §6h: advanced = STONK profile every tick, universe + stock counts hourly, deltas daily, 100 ms pacing; HOLDERSCAN_RETENTION_DAYS=90
ATH_ALERT_COOLDOWN_MIN=60                              # all-time-high posts (§6d): at most one per this many minutes
NEXT_PUBLIC_SITE_URL                # optional; canonical origin, defaults to https://stonk.fyi
```

Run: `npm install && npm run dev` → http://localhost:3000. Health: `/api/health`. Offline: `DATA_SOURCE=fixture npm run dev`.

---

## 9. Known gaps & honest notes

- Burn velocity is a rolling 4h rate (2026-09-10): burns recorded in `token_burns` over the trailing 4h, merged with the API's live tail (~25 events) so the newest burns count before the worker has stored them, divided by a fixed 4h. Without a DB only the API tail exists; then the window is however far back it reaches (≤4h) and the detail says "estimate". `BURN_RATE_WINDOW_H` in `lib/stonk.ts`.
- `/tokens/{mint}/burns` does not paginate the full 10k+ ledger (or we haven't found how); full history comes from the worker accumulating it.
- Daily buyback dollars on the home page are an estimate (daily revenue × lifetime buyback share) until the worker records real buybacks.
- STONK also trades outside the main pool (Jupiter routing, and every STONK-quoted pool holds STONK). The pool-depth and net-flow indicators cover the main pool only.
- Platform revenue is volatile (from <$20K to >$1.5M/day in the first six weeks). Buyback pressure follows it with no lag.
- The scorecard thresholds are judgment calls made on ~6 weeks of data. Revisit them as history accumulates, and say so on the page if they change.
- StonkFun is a third-party launchpad; this site is unofficial and must keep saying so (footer + about).

---

## 10. Production setup & operations (as of 2026-09-07)

| Thing | Where | Notes |
|---|---|---|
| Site | https://stonk.fyi (www → 308 to apex) | Vercel project `stonk-fyi`, team "hankobaggins' projects", **Pro plan** (badge seen 2026-09-11; `/api/cron/census` relies on its 800 s function limit), auto-deploys `main` |
| Code | https://github.com/hankobaggins/stonk-fyi (public) | GitHub user `hankobaggins` |
| Domain | Namecheap | `A @ 216.198.79.1`, `CNAME www f88710b66a90a2cc.vercel-dns-017.com` |
| Database | Supabase project `stonk-fyi` (`hhmvbsianukqhbzsmuuh`), East US, free tier | org "hankobaggins's Org" |
| Snapshot tick | Supabase pg_cron jobs `snapshot_tick` / `snapshot_hourly` (Vault secret `cron_secret`) | GitHub Actions `snapshot` workflow is the manual/fallback path (secrets `SNAPSHOT_URL`, `CRON_SECRET`) |
| Vercel env | `DATA_SOURCE=live`, `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SOCIALBU_TOKEN`, `SOCIALBU_ACCOUNT_ID` | service-role key is the *legacy* `service_role` JWT from Supabase → API Keys |

**Deploy:** push to `main`. Vercel builds in ~40s. Preview deploys for branches share the same env except `SUPABASE_*` (Production only) — previews run without the DB, which is the intended fallback.

**When something looks wrong:** `https://stonk.fyi/api/health` first. Then Vercel → Logs. Then `gh run list --workflow snapshot`. Supabase usage: dashboard → Usage (watch database size; if it climbs past ~300 MB, shorten `SNAPSHOT_RETENTION_DAYS` in the worker).

**Secrets rotation:** changing `CRON_SECRET` means updating it in Vercel env, Supabase Vault (`cron_secret`) and the GitHub repo secret. The service-role key lives only in Vercel.

**Network quirks for tooling:** from this project's Cowork sessions, the user's local shell can reach GitHub and npm but not Vercel/Supabase; the cloud sandbox can reach neither GitHub-for-push nor Vercel. Vercel and Supabase dashboards are driven through the user's Chrome. `gh` is installed at `~/bin/gh` in the local VM and authenticated as `hankobaggins`.
