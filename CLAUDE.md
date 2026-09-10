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
  tokens/page.tsx           searchable/filterable/paginated token table (URL search params)
  tokens/[mint]/page.tsx    token detail
  pairs/page.tsx            volume & mcap by quote asset / category (aggregates top 300 by volume)
  flywheel/page.tsx         revenue → buyback → burn
  launches/page.tsx         launch ledger & velocity
  yield/page.tsx            holder-fee APR table: the 10 largest reward coins (≥72h old) that paid holders in the last 3 days, with
                            24h- and 3d-based realized APR bars (added 2026-09-09; needs migration 0005 + the `rewards` worker step)
  about/page.tsx            methodology, data sources, scorecard thresholds, projection model, known gaps (public)
  api/buybacks/route.ts     protocol-event feed for the toasts: recent buybacks + non-buyback STONK burns, sorted (no-store; upstream 20-30s)
  api/health/route.ts       per-upstream diagnostics (USE THIS FIRST when anything looks wrong)
  api/cron/snapshot/route.ts  snapshot worker (Phase 2) — tiered cadence, see §6; includes the burn_alert step (§6a)
  burn-card/[id]/route.tsx  1600×900 PNG for a big-burn alert (what gets tweeted; /burn-card/preview for eyeballing)
  ath-card/route.tsx        1200×1200 PNG for an all-time-high post (headline = StonkFun's peakMarketCapUsd, plus where it stands now,
                            24h change, peak vs launch, supply burned). Card itself is the pure `lib/ath-card.tsx`, rendered live; nothing stored
  milestone-card/[id]/route.tsx  1200×1200 PNG for a burn milestone (id = whole percent, e.g. /milestone-card/14; /milestone-card/preview
                            renders the current level live). Card is the pure `lib/milestone-card.tsx`; the worker step is §6c
  buyback-card/route.tsx    1200×1200 PNG: top 5 quote coins by USD spent buying STONK over `?hours=N` (default 1), from the
                            `buybacks` ledger via `getBuybackLeaderboard()` (added 2026-09-09). `?format=json` returns the numbers.
                            Card is the pure `lib/buyback-card.tsx`, big figures only, bars in `--up`. 503 when the DB is unset or the window is empty. Note "coins"
                            here are the fee/quote assets that funded buybacks — the API has no per-launched-token revenue figure
  yield-card/route.tsx      1600×900 PNG: top 10 coins on the /yield table by realized holder-fee APR over `?window=3d` (default) or `24h`
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
src/fixtures/*.json         real API responses captured 2026-09-06/07, served when DATA_SOURCE=fixture
src/lib/burn-milestones.ts, milestone-math.ts   burn-milestone worker step (§6c) and its pure math (scripts/burn-milestone-check.ts)
supabase/migrations/0001_init.sql   full schema incl. RLS (see §6) — applied to production 2026-09-07
supabase/migrations/0005_reward_snapshots.sql   reward_snapshots table — paste into the SQL editor by hand
supabase/migrations/0006_reward_snapshots_scoped.sql   reward_payout_window(win_hours, mints) + reward_snapshots_prune() + one-off cleanup of 0005's 1.2M rows (2026-09-10) — by hand too
supabase/migrations/0007_burn_milestones.sql   burn_milestones table (§6c) — paste into the SQL editor by hand
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
| holders (GMGN) | unique holders; scored on 24h change from `gmgn_snapshots` once ≥12h exist | > +0.5%/24h (neutral ±0.5%) |
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
13. **Not financial advice.** Keep the disclaimers that exist; don't add "buy" language anywhere.
14. **Commit hygiene** (if a repo is set up): conventional short messages; never commit `.env.local`; `next-env.d.ts` and `.next/` are generated.

---

## 6. Phase 2 — snapshot worker (running in production)

`GET /api/cron/snapshot` (auth: `Authorization: Bearer $CRON_SECRET`). Steps, each isolated so one failure doesn't stop the others: `platform` (stats+revenue → `platform_snapshots`, recent buybacks → `buybacks`), `revenue_daily`, `launches`, `stonk_burns` (→ `token_burns`), `burn_alert` (§6a), `burn_milestone` (§6c), `pool` (Raydium reserves → `pool_snapshots`), `rewards` (lifetime `distributedTokens` for the `YIELD_TRACKED`=200 largest reward coins by market cap → `reward_snapshots`, ~200 rows a tick; feeds `/yield`; in full mode also prunes untracked coins and readings older than 14 days), `gmgn` (holder count, concentration, wallet tags, buy/sell volume → `gmgn_snapshots`; 0 rows when `GMGN_API_KEY` is unset), `tokens` (→ `tokens` + `token_snapshots`), and in full mode `prune`.

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

## 6b — Holder-fee APR (`/yield`, added 2026-09-09)

The owner asked for a "largest yield-paying coins, 24h vs 3d APR" table like a third-party chart whose formula (volume × fee rate with assumed exclusions and an "operating fee") is not reproducible. The site instead shows a **realized** APR: `(Δ lifetime payout tokens over the window × quote USD price now) ÷ market cap now × (8760 ÷ hours covered)`. Payout deltas come from `reward_snapshots` via the `reward_payout_window(win_hours, mints)` SQL function (per requested mint: newest reading, and the newest reading at or before the window start, falling back to the earliest reading — three primary-key probes per mint, so it stays fast at any table size); a window is shown once readings cover ≥80% of it, else the cell says "collecting". Coins must be ≥72h old and have paid inside the 72h window; ranking is by market cap (top 100 reward coins by mcap from `/tokens?mode=reward`). `getRewardCoinsByMcap(n)` in `lib/yield.ts` is the one definition of "tracked coins", used by both the worker (n=200) and the page (n=100).

**Post-mortem 2026-09-10 ("yield never populated").** 0005's worker step recorded every coin that paid in the last 7 days, sized from the fixture (193 launches → "~50 rows a tick"). Live that was 5,328 coins a tick: 1,216,672 rows / 333 MB in 21.5 h, and the unscoped `reward_payout_window(win_hours)` (three full `DISTINCT ON` sorts) stopped finishing inside the API's 8 s statement timeout (its result, 5,376 rows, would also have exceeded PostgREST's 1,000-row cap). `getRewardWindows` swallowed the error and returned null, so the page said "collecting: under an hour" while `/api/health` happily reported 21.5 h of history. Fixes: scoped tracking + scoped function (0006), the RPC error is now logged and shown as its own page state (`db-error`), and `/api/health` → `reward_windows` makes the exact call the page makes. Lesson for every worker step: size the row count from the live endpoint, not the fixture, and give every DB read the page depends on a health check that runs the same query. Quote prices: Jupiter, STONK at StonkFun's price. Market cap is the denominator (understates yield on eligible balance — said on the page and on /about#yield). The whole table is empty until ~20h of readings exist and the 3d column until ~58h. `/api/health` → `reward_snapshots` shows staleness of the newest reading (error = 0005 missing or the step stalled) and `reward_windows` runs the page's own window query on the top-100 mints (error = 0006 missing or a timeout).

## 6a — Big-burn alerts → X (added 2026-09-08)

**Rule:** if STONK burns inside the last 10 minutes (`BURN_ALERT_WINDOW_MIN`), minus burns already announced, are worth ≥ **$10,000** at StonkFun's value-at-burn (`BURN_ALERT_THRESHOLD_USD`; USD, not tokens; lowered from $50K on 2026-09-08), the worker posts a card to X. Runs as the `burn_alert` step of every tick. Detection slides a 10-min window over every burn the API returns (~25 most recent), not just the last 10 minutes, so a late tick still catches a window that already closed; announced signatures are excluded so nothing is double-counted. ~~Known problem (2026-09-08): GitHub's `*/5` schedule fired ~every 4–5 hours, which is why a $20K window went unannounced.~~ Fixed the same day by moving the tick to Supabase pg_cron (§6).

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

**Card** (`lib/milestone-card.tsx`, square): the whole percent as the headline, the burn ring at 300px (bite = burned share), tokens burned of 1B and days since launch, then 2×2: tokens burned, lifetime USD at burn (StonkFun pricing, labelled), "last 1% took" (from the previous row's `reached_at`; "first tracked" when unknown), burn velocity with its real scorecard state and "next 1% in ~N days" at that pace in the label. Tweet (`buildMilestoneText`): two plain sentences, no links — `14% of $STONK supply is now burned: 140,012,345 tokens, about $2.1M at StonkFun pricing, 49 days after launch.` / `The last 1% took 4.2 days. Burn velocity 0.31%/day.`

**Ops**
- Same env as §6a (`SOCIALBU_TOKEN`, `SOCIALBU_ACCOUNT_ID`); unset or `?dry=1` → `dry_run` rows with a card URL, nothing posted.
- **Migration `0007_burn_milestones.sql` must be pasted into the SQL editor by hand before the step can write**; until then the step fails (isolated, the rest of the tick is unaffected) and `/api/health` → `burn_milestones` reports the error.
- `/api/health` → `burn_milestones`: mode, last row (`13% seeded at …`), and the next percent that will post. Tick response `notes.burn_milestone` says `14% posted` (or `dry_run`, plus any skipped).
- Re-post by hand: the card at `/milestone-card/{pct}` is reproducible from the stored row; `seeded` and `skipped` rows 404 there.

## 7. Roadmap (in priority order)

1. ~~Deploy to Vercel + turn on Supabase worker~~ — done 2026-09-07.
2. ~~Wire DB-backed charts~~ Done 2026-09-08 for token detail (`TokenHistoryChart`, 7d, `getTokenHistory`) and platform revenue pace (`getRevenuePace`) and launch velocity (`getLaunchVelocity`). Still open: STONK home price chart from snapshots instead of CoinGecko; the daily volume chart. Original note: wire DB-backed charts into the STONK page and token detail; add a `getStonkHistory()` in `db.ts` reading `token_snapshots` for `STONK_MINT`.
3. ~~**Independent price check**~~ — done via GMGN (Orca STONK/SOL pool price, spread under the hero price). Jupiter/DexScreener would add a second independent source.
4. **Phase 3 on-chain (Helius):** ~~holder count & top-holder concentration~~ (now via GMGN; Helius would make them first-party), unique traders/day, on-chain verification of burn totals against the mint's supply, pool liquidity distribution around the current tick (would make the projection ceiling realistic).
5. **Public-site polish:** ~~OG image / social card, `robots.txt`, sitemap, `/about` page, mobile pass, favicon, visual redesign (ledger concept)~~ done. Remaining: analytics (Vercel Web Analytics is one click in the dashboard).
6. **Yield:** `/yield` is live-computed; once a week of `reward_snapshots` exists, consider a 7d column and a per-coin payout sparkline on the token page.
7. **Alerts:** ~~big-burn card to X~~ (done 2026-09-08, §6a). ~~Burn milestones (every 1% of supply)~~ done 2026-09-10, §6c. Next on the same rail: indicator flips, daily revenue records. `/buyback-card?hours=1` (2026-09-09) and `/yield-card` (2026-09-10) are hand-posted cards for now; an hourly or daily "who paid for the buybacks" post could reuse it.

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
BURN_ALERT_THRESHOLD_USD=10000, BURN_ALERT_WINDOW_MIN=10  # optional overrides (USD at burn)
NEXT_PUBLIC_SITE_URL                # optional; canonical origin, defaults to https://stonk.fyi
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

---

## 10. Production setup & operations (as of 2026-09-07)

| Thing | Where | Notes |
|---|---|---|
| Site | https://stonk.fyi (www → 308 to apex) | Vercel project `stonk-fyi`, team "hankobaggins' projects", Hobby plan, auto-deploys `main` |
| Code | https://github.com/hankobaggins/stonk-fyi (public) | GitHub user `hankobaggins` |
| Domain | Namecheap | `A @ 216.198.79.1`, `CNAME www f88710b66a90a2cc.vercel-dns-017.com` |
| Database | Supabase project `stonk-fyi` (`hhmvbsianukqhbzsmuuh`), East US, free tier | org "hankobaggins's Org" |
| Snapshot tick | Supabase pg_cron jobs `snapshot_tick` / `snapshot_hourly` (Vault secret `cron_secret`) | GitHub Actions `snapshot` workflow is the manual/fallback path (secrets `SNAPSHOT_URL`, `CRON_SECRET`) |
| Vercel env | `DATA_SOURCE=live`, `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SOCIALBU_TOKEN`, `SOCIALBU_ACCOUNT_ID` | service-role key is the *legacy* `service_role` JWT from Supabase → API Keys |

**Deploy:** push to `main`. Vercel builds in ~40s. Preview deploys for branches share the same env except `SUPABASE_*` (Production only) — previews run without the DB, which is the intended fallback.

**When something looks wrong:** `https://stonk.fyi/api/health` first. Then Vercel → Logs. Then `gh run list --workflow snapshot`. Supabase usage: dashboard → Usage (watch database size; if it climbs past ~300 MB, shorten `SNAPSHOT_RETENTION_DAYS` in the worker).

**Secrets rotation:** changing `CRON_SECRET` means updating it in Vercel env, Supabase Vault (`cron_secret`) and the GitHub repo secret. The service-role key lives only in Vercel.

**Network quirks for tooling:** from this project's Cowork sessions, the user's local shell can reach GitHub and npm but not Vercel/Supabase; the cloud sandbox can reach neither GitHub-for-push nor Vercel. Vercel and Supabase dashboards are driven through the user's Chrome. `gh` is installed at `~/bin/gh` in the local VM and authenticated as `hankobaggins`.
