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
  about/page.tsx            methodology, data sources, scorecard thresholds, projection model, known gaps (public)
  api/buybacks/route.ts     protocol-event feed for the toasts: recent buybacks + non-buyback STONK burns, sorted (no-store; upstream 20-30s)
  api/health/route.ts       per-upstream diagnostics (USE THIS FIRST when anything looks wrong)
  api/cron/snapshot/route.ts  snapshot worker (Phase 2) — tiered cadence, see §6
  opengraph-image.tsx, twitter-image.tsx   social card (next/og; dynamic, carries the live tally bar), icon.svg (burn ring favicon), robots.ts, sitemap.ts
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
supabase/migrations/0001_init.sql   full schema incl. RLS (see §6) — applied to production 2026-09-07
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
| `/rewards` | `{ launches:[{mint,quote,distributedTokens,payoutCount,holderCount,lastPayoutAt}] }` | verified |

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
5. **Verify visually.** `DATA_SOURCE=fixture npx next build && DATA_SOURCE=fixture npx next start -p 3111`, then `CHROME_PATH=<chromium> node scripts/screenshot.mjs http://localhost:3111` and look at the PNGs. From a Cowork session the local VM cannot delete files in the mounted repo (so `next build` cannot clear `.next`) and each shell call is its own sandbox: copy `src public package*.json *.config.* tsconfig.json` to `$HOME/sf`, `npm ci` there, build, and start+curl in a single call. Tables must scroll inside their container (`.table-wrap`), never the page. Broken avatar images in fixture mode are expected (no network); live they load.
6. **Rate limits.** Home page ≈ 8 upstream requests; pairs page = 3; a full token walk = ~160 requests (16k tokens / 100). Keep `revalidate` windows; don't add per-row fetches.
7. **Dark theme only, by design.** The visual system is the "ledger" concept (2026-09-07, see the project doc `design-concept.md`): teal-black neutrals that share StonkFun's temperature (`--bg #0a1317`), a single teal accent (`--accent`) reserved for provenance links, nav and the ring mark, and a separate status set (`--up` bullish, `--caution`, `--neutral`, `--down`) that is never reused for chart series. Geist for prose, Geist Mono (`.num`, `.label`, `.src`) for every figure, address, endpoint and timestamp. Only leaf content is boxed (`.ind`, `.card`); groups are separated by rules, not nested cards. Signature marks: the tally bar (`TallyBar`, one segment per indicator, also on the OG card), the burn ring (`BurnRing`: nav mark, `icon.svg`, supply chart — the bite is the burned share), the state stripe on `.ind`, and the `Ticker` strip under the nav. Palette lives in `globals.css` (`--series-1..8` follow the validated dark-mode data-viz palette: blue, orange, aqua, yellow, magenta, green, violet, red). Categorical colors are assigned in fixed order, never cycled by rank. One y-axis per chart, no dual axes.
8. **Copy discipline.** Plain language, no hype adjectives, no "genuinely/honestly". Every metric tile has a one-line `sub` explaining what it is. Caveats live next to the number they qualify, not in a footer. Indicator `detail` is one sentence; the reasoning behind a threshold lives on /about, not in the cell. Never state the same figure twice on one page (the "−N% from peak" figure appeared five times before the 2026-09-07 copy pass).
9. **Refresh cadence is stated where the number is.** Every `source` line ends with its cache window (`/revenue · 30s`, `pool_snapshots · 5 min`), chart headers carry their resolution, the nav pill says "updated Ns ago", and /about has the full "How fresh is this?" table. Keep those in sync when changing a `revalidate`.
10. **Not financial advice.** Keep the disclaimers that exist; don't add "buy" language anywhere.
11. **Commit hygiene** (if a repo is set up): conventional short messages; never commit `.env.local`; `next-env.d.ts` and `.next/` are generated.

---

## 6. Phase 2 — snapshot worker (running in production)

`GET /api/cron/snapshot` (auth: `Authorization: Bearer $CRON_SECRET`). Steps, each isolated so one failure doesn't stop the others: `platform` (stats+revenue → `platform_snapshots`, recent buybacks → `buybacks`), `revenue_daily`, `launches`, `stonk_burns` (→ `token_burns`), `pool` (Raydium reserves → `pool_snapshots`), `gmgn` (holder count, concentration, wallet tags, buy/sell volume → `gmgn_snapshots`; 0 rows when `GMGN_API_KEY` is unset), `tokens` (→ `tokens` + `token_snapshots`), and in full mode `prune`.

**Cadence is tiered to fit Supabase's 500 MB free tier** (the naive "every active token every 5 min" was ~1.7M rows/day and would have filled it in days):

| Mode | Who fires it | Tokens snapshotted |
|---|---|---|
| tick (default) | GitHub Actions `snapshot.yml`, every 5 min | STONK + top 100 by volume |
| `?hourly=1` | same workflow, at minute 0–4 of each hour | top 500 |
| `?full=1` | Vercel cron (`vercel.json`), daily 03:00 UTC | every page (~165 requests), then deletes non-STONK `token_snapshots` older than 30 days |

≈ 8 MB/day. STONK's own history is never pruned. `maxDuration = 300` (Fluid compute) so the full walk fits.

**Why GitHub Actions:** Vercel's Hobby plan only allows daily cron. The workflow needs two repo secrets, `SNAPSHOT_URL` (`https://stonk.fyi`) and `CRON_SECRET` (same value as the Vercel env var). Both are set. GitHub's scheduler can lag a few minutes under load; that's fine for this.

**Schema:** `supabase/migrations/0001_init.sql`, with RLS enabled on every table (no policies → the anon/publishable key can read nothing; the site and worker use the service-role key, which bypasses RLS). Supabase's GitHub integration is also linked to the repo and may apply new files in `supabase/migrations/` on push to main — treat that as a convenience, not a guarantee; verify in the SQL editor.

**Verify it's alive:** `/api/health` → `supabase` check reports the `platform_snapshots` count; or in the Supabase SQL editor: `select ts, count(*) from token_snapshots group by ts order by ts desc limit 5;` — expect ~100 rows every 5 min, ~500 at the top of the hour. `gh run list --repo hankobaggins/stonk-fyi --workflow snapshot` shows tick results (the step fails on any non-200).

**What unlocks now that data accumulates:** real STONK price/mcap/volume charts on the token page (replace the "Price history" placeholder), burns-per-day over full history, buyback USD per day from the actual ledger instead of the revenue × share estimate, the net-flow indicator (after 12h), volume-by-pair over time, and STONK-quoted-token count over time.

## 7. Roadmap (in priority order)

1. ~~Deploy to Vercel + turn on Supabase worker~~ — done 2026-09-07.
2. **Wire DB-backed charts** into the STONK page and token detail; add a `getStonkHistory()` in `db.ts` reading `token_snapshots` for `STONK_MINT`.
3. ~~**Independent price check**~~ — done via GMGN (Orca STONK/SOL pool price, spread under the hero price). Jupiter/DexScreener would add a second independent source.
4. **Phase 3 on-chain (Helius):** ~~holder count & top-holder concentration~~ (now via GMGN; Helius would make them first-party), unique traders/day, on-chain verification of burn totals against the mint's supply, pool liquidity distribution around the current tick (would make the projection ceiling realistic).
5. **Public-site polish:** ~~OG image / social card, `robots.txt`, sitemap, `/about` page, mobile pass, favicon, visual redesign (ledger concept)~~ done. Remaining: analytics (Vercel Web Analytics is one click in the dashboard).
6. **Alerts (optional):** a scheduled job that posts to Telegram/X when an indicator flips, a burn milestone passes (e.g. 15% of supply), or revenue sets a daily record.

---

## 8. Environment

```
DATA_SOURCE=live | fixture          # fixture = offline dev on captured JSON
STONKFUN_API_BASE                   # override, default https://www.stonkfun.xyz/api/public/v1
RAYDIUM_API_BASE                    # override, default https://api-v3.raydium.io
COINGECKO_STONK_ID=stonk-3          # optional; COINGECKO_API_KEY optional demo key
GMGN_API_KEY                        # optional; enables the Holders & flow section + gmgn worker step
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET   # Phase 2 only
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
| Snapshot tick | GitHub Actions `snapshot` workflow | secrets `SNAPSHOT_URL`, `CRON_SECRET` |
| Vercel env | `DATA_SOURCE=live`, `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | service-role key is the *legacy* `service_role` JWT from Supabase → API Keys |

**Deploy:** push to `main`. Vercel builds in ~40s. Preview deploys for branches share the same env except `SUPABASE_*` (Production only) — previews run without the DB, which is the intended fallback.

**When something looks wrong:** `https://stonk.fyi/api/health` first. Then Vercel → Logs. Then `gh run list --workflow snapshot`. Supabase usage: dashboard → Usage (watch database size; if it climbs past ~300 MB, shorten `SNAPSHOT_RETENTION_DAYS` in the worker).

**Secrets rotation:** changing `CRON_SECRET` means updating it in both Vercel env and the GitHub repo secret. The service-role key lives only in Vercel.

**Network quirks for tooling:** from this project's Cowork sessions, the user's local shell can reach GitHub and npm but not Vercel/Supabase; the cloud sandbox can reach neither GitHub-for-push nor Vercel. Vercel and Supabase dashboards are driven through the user's Chrome. `gh` is installed at `~/bin/gh` in the local VM and authenticated as `hankobaggins`.
