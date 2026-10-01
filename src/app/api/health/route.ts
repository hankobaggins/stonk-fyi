import { NextResponse } from "next/server";
import { getLaunches, getPairs, getRevenue, getRevenueHistory, getStats, getStonkPriceHistory, getToken, getTokenBurns, getTokens, STONK_MINT } from "@/lib/api";
import { getPoolInfo } from "@/lib/raydium";
import { DB_BREAKER_MS, dbBreakerOpen, getDb, getLaunchVelocity, getRewardWindows } from "@/lib/db";
import { BURN_ALERT_COOLDOWN_MIN, BURN_ALERT_THRESHOLD_USD, BURN_ALERT_WINDOW_MIN, recentBurnAlerts } from "@/lib/burn-alerts";
import { latestMilestone } from "@/lib/burn-milestones";
import { ATH_ALERT_COOLDOWN_MIN, highestAth, lastAthPost } from "@/lib/ath-alerts";
import { FIRE_ALERT_COOLDOWN_MIN, FIRE_ALERT_REARM_PCT, FIRE_ALERT_THRESHOLD_PCT, lastVelocityPost, lastVelocityRow, VELOCITY_ALERT_COOLDOWN_MIN, VELOCITY_ALERT_REARM_PCT, VELOCITY_ALERT_THRESHOLD_PCT } from "@/lib/velocity-alerts";
import { getGmgnStonk, lastGmgnError } from "@/lib/gmgn";
import { getStonkData, STONK_POOL } from "@/lib/stonk";
import { getRewardCoinsByMcap } from "@/lib/yield";
import { COIN_CENSUS_EVERY_H, COIN_CENSUS_MAX_PAGES, getWalletCensus, QUOTE_CENSUS_MAX_PAGES, WALLET_CENSUS_EVERY_H } from "@/lib/wallets";
import { COIN_DELTAS_TOP, DELTAS_EVERY_DAYS, UNIVERSE_EVERY_H, getCoinCensus, getMintCounts, getCoinDeltaTotals, getLatestDeltas, getQuoteHolderWindows, getUniverse } from "@/lib/universe";
import { HOLDERSCAN_ADVANCED, holderscanEnabled, lastHolderscanError } from "@/lib/holderscan";
import { getHolderHistory, PROFILE_EVERY_MIN } from "@/lib/stonk-holders";
import { COIN_PROFILES_EVERY_H, COIN_PROFILES_TOP, getCoinProfiles, TOP_COINS_SHOWN } from "@/lib/coin-profiles";
import { runnersHealth } from "@/lib/runners";
import { getJupiterTokens, getPythFeeds, getQuoteBoard, lastQuoteAssetError } from "@/lib/quote-assets";
import { PAGE_UNITS_PER_H, pageMeter, TOKEN_HOLDERS_TTL_MIN, TOKEN_PROFILE_UNITS } from "@/lib/token-holders";
import { getDistributors, REWARDS_CREDITS_PER_H, REWARDS_REFRESH_MIN, rewardsMeter } from "@/lib/wallet-rewards";
import { distKey } from "@/lib/wallet-rewards-math";

// Diagnostics: GET /api/health → per-source status so a broken page can be traced to its upstream.
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { ok: boolean; ms: number; note?: string }> = {};
  const run = async (name: string, fn: () => Promise<string | void>) => {
    const t0 = Date.now();
    try {
      const note = await fn();
      checks[name] = { ok: true, ms: Date.now() - t0, ...(note ? { note } : {}) };
    } catch (e) {
      checks[name] = { ok: false, ms: Date.now() - t0, note: (e as Error).message };
    }
  };

  await Promise.all([
    run("stonkfun:/stats", async () => `${(await getStats()).data.tokens.total} tokens`),
    run("stonkfun:/revenue", async () => `${(await getRevenue()).data.recentBuybacks.length} recent buybacks`),
    run("stonkfun:/revenue/history", async () => `${(await getRevenueHistory()).data.days.length} days`),
    run("stonkfun:/tokens", async () => `${(await getTokens({ pageSize: 1 })).data.pagination.total} total`),
    run("stonkfun:/tokens/STONK", async () => {
      const t = await getToken(STONK_MINT);
      if (!t) throw new Error("404");
      return `price ${t.data.token.market?.priceUsd ?? "missing"}`;
    }),
    run("stonk_reading", async () => {
      // The page's own read, through the staleness guard (lib/stale-reading.ts): fails while the record
      // StonkFun serves is stale and nothing better could be shown.
      const d = await getStonkData();
      const m = d.token.market ?? {};
      const head = `price ${m.priceUsd?.toFixed(4)} · mcap $${((m.marketCapUsd ?? 0) / 1e6).toFixed(2)}M · implied supply ${((d.supply.impliedFromMarket ?? 0) / 1e6).toFixed(2)}M vs ${(d.supply.circulating / 1e6).toFixed(2)}M circulating`;
      const s = d.staleReading;
      if (!s) return `${head} · passed`;
      if (s.served === "refetch") return `${head} · first read was stale (${s.reason.code}: ${s.reason.detail}), re-read passed`;
      if (s.served === "last-good") throw new Error(`stale (${s.reason.code}: ${s.reason.detail}) · serving the last good reading from ${s.readAt}`);
      throw new Error(`stale (${s.reason.code}: ${s.reason.detail}) · no good reading to fall back to, served as-is`);
    }),
    run("stonkfun:/tokens/STONK/burns", async () => {
      const b = await getTokenBurns(STONK_MINT);
      return b ? `${b.totals.amountTokens.toFixed(0)} burned` : "null";
    }),
    run("stonkfun:/tokens?quoteMint=STONK", async () => `${(await getTokens({ quoteMint: STONK_MINT, pageSize: 1 })).data.pagination.total} quoted`),
    run("stonkfun:/launches", async () => `${(await getLaunches({ pageSize: 1 })).data.pagination.total} launches`),
    run("stonkfun:/pairs", async () => `${(await getPairs()).length} pairs`),
    run("pyth:feed_list", async () => {
      const f = await getPythFeeds();
      if (!f) throw new Error(lastQuoteAssetError() ?? "null");
      return `${f.us.length} US session feeds · ${f.index.length} always-on · ${f.crypto.length} crypto`;
    }),
    run("jupiter:tokens", async () => {
      const m = await getJupiterTokens([STONK_MINT]);
      const t = m.get(STONK_MINT);
      if (!t) throw new Error(lastQuoteAssetError() ?? "STONK missing");
      return `STONK liquidity $${((t.liquidityUsd ?? 0) / 1e6).toFixed(2)}M · ${t.holders} holders`;
    }),
    run("quote_board", async () => {
      // The /pairs page's own read: stock quote assets, Jupiter coverage, oracle gap.
      const b = await getQuoteBoard();
      const priced = b.rows.filter((r) => r.priceUsd != null).length;
      if (!b.jupOk) throw new Error(`no Jupiter data for ${b.rows.length} stock quote assets (${lastQuoteAssetError() ?? "?"})`);
      return `${b.rows.length} stock quote assets, ${priced} priced · ${b.gap ? `${b.gap.dark} of ${b.gap.equities} used have no price after the close` : "Pyth list unavailable"} · ${b.groups.length} multi-issuer groups`;
    }),
    run("raydium:pool", async () => {
      const p = await getPoolInfo(STONK_POOL);
      if (!p) throw new Error("null (blocked or shape changed)");
      return `tvl ${p.tvl.toFixed(0)}`;
    }),
    run("coingecko:history", async () => {
      const h = await getStonkPriceHistory(7);
      if (!h) throw new Error("null (blocked, rate-limited, or wrong coin id)");
      return `${h.length} points`;
    }),
    run("gmgn:token", async () => {
      if (!process.env.GMGN_API_KEY) return "skipped (GMGN_API_KEY unset)";
      const g = await getGmgnStonk();
      if (!g) throw new Error(lastGmgnError ?? "null (cached failure; retry in ~1 min)");
      return `${g.holderCount} holders, price ${g.priceUsd}`;
    }),
    run("supabase", async () => {
      if (dbBreakerOpen()) throw new Error(`breaker open: a page read failed at the transport level in the last ${DB_BREAKER_MS / 1000}s, page reads are skipped on this instance until it closes`);
      const db = getDb();
      if (!db) return "not configured (optional)";
      const { error, count } = await db.from("platform_snapshots").select("ts", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      const { data: latest } = await db.from("platform_snapshots").select("ts").order("ts", { ascending: false }).limit(1);
      const lastTs = latest?.[0]?.ts as string | undefined;
      if (!lastTs) return `${count ?? 0} platform snapshots, none yet`;
      const ageMin = (Date.now() - Date.parse(lastTs)) / 60000;
      const note = `${count ?? 0} platform snapshots, last ${ageMin.toFixed(0)} min ago`;
      // The tick runs every 5 min; anything past 15 min means the trigger has stalled (see CLAUDE.md §6).
      if (ageMin > 15) throw new Error(`${note} — snapshot tick stalled`);
      return note;
    }),
    run("launch_velocity", async () => {
      // The figure /launches and /platform show, with its source and any upstream counter reset in
      // the window. StonkFun's /stats tokens.total fell from 74.6K to 8.3K on 2026-09-18 17:45 UTC
      // (the launchlab tokens left their index) while /launches kept counting; the worker stores
      // the ledger total since migration 0020 and reads it first. Fails while the figure is
      // unavailable, or while it still comes from the token index after a reset.
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const [vel, stats, launches] = await Promise.all([getLaunchVelocity(24), getStats(), getLaunches({ pageSize: 1 })]);
      const idx = stats.data.tokens.total;
      const ledger = launches.data.pagination.total;
      const upstream = `StonkFun: ${ledger} launches on the ledger, ${idx} tokens in the index`;
      if (!vel) throw new Error(`unavailable: under 30 min of readings since the newest counter reset (migration 0020 applied?) · ${upstream}`);
      const reset = vel.reset ? ` · counter reset at ${vel.reset.ts} (${vel.reset.before} → ${vel.reset.after})` : "";
      const note = `${vel.perHour.toFixed(1)}/h, ${vel.launches} over ${vel.hours.toFixed(1)}h from ${vel.source === "launches" ? "launches_total (ledger)" : "tokens_total (token index)"}${reset} · ${upstream}`;
      if (vel.source === "tokens" && vel.reset) throw new Error(`${note} — token index reset upstream; the ledger column (0020) takes over once it covers 12h`);
      return note;
    }),
    run("reward_snapshots", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const { data: last, error } = await db.from("reward_snapshots").select("ts").order("ts", { ascending: false }).limit(1);
      if (error) throw new Error(`${error.message} (migration 0005 applied?)`);
      if (!last?.[0]) return "no readings yet";
      // No count(*) here: it was a 3 s full scan at 1.2M rows and the table is meant to stay small.
      const ageMin = (Date.now() - Date.parse(last[0].ts)) / 60000;
      const note = `last reading ${ageMin.toFixed(0)} min ago`;
      if (ageMin > 15) throw new Error(`${note} — rewards step stalled`);
      return note;
    }),
    run("reward_windows", async () => {
      // The exact call /tokens makes for its APR columns, on the top-100 reward coins by market cap: fails on a missing 0006 or a timeout.
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const coins = await getRewardCoinsByMcap(100);
      const w = await getRewardWindows(72, coins.map((c) => c.token.mint));
      if (!w) throw new Error("reward_payout_window failed (migration 0006 applied? see server log)");
      let hours = 0;
      for (const x of w.values()) hours = Math.max(hours, x.hours);
      return `${w.size} of ${coins.length} tracked coins have readings, ${hours.toFixed(1)}h of history`;
    }),
    run("wallet_census", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const key = process.env.HELIUS_API_KEY ? "HELIUS_API_KEY set" : "HELIUS_API_KEY unset — the step cannot run";
      const c = await getWalletCensus(2);
      if (c.status === "db-error") throw new Error(`wallet_runs unreadable (migration 0010 applied?) · ${key}`);
      if (!c.latest) return `${key} · no run yet (every ${WALLET_CENSUS_EVERY_H}h on the :45 tick, or /api/cron/census?sync=1)`;
      const ageH = (Date.now() - Date.parse(c.latest.ts)) / 3.6e6;
      const last = c.runs[c.runs.length - 1];
      const wallets = last ? last.hist.reduce((a, b) => a + b, 0) : 0;
      const mc = await getMintCounts();
      const truncated = mc ? [...mc.values()].filter((x) => x.truncated).length : 0;
      const note = `${key} · last run ${ageH.toFixed(1)}h ago: ${wallets} stock-token wallets, ${c.latest.mintsOk} quote assets ok / ${c.latest.mintsFailed} failed${c.latest.firstError ? ` (${c.latest.firstError})` : ""}${mc ? ` · on-chain counts for ${mc.size} assets, ${truncated} past the ${QUOTE_CENSUS_MAX_PAGES}-page cap` : " · mint counts unreadable (migration 0015 applied?)"}${c.latest.durationMs ? ` · ${(c.latest.durationMs / 1000).toFixed(0)}s` : ""}`;
      if (ageH > WALLET_CENSUS_EVERY_H * 1.5) throw new Error(`${note} — census stalled`);
      return note;
    }),
    run("universe_holders", async () => {
      // §6g: HolderScan holder count per universe quote asset, daily. The page's own window query.
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const key = holderscanEnabled() ? "HOLDERSCAN_API_KEY set" : "HOLDERSCAN_API_KEY unset — the step is skipped";
      const { assets } = await getUniverse();
      const w = await getQuoteHolderWindows(720, assets.map((a) => a.mint));
      if (!w) throw new Error(`quote_holder_window failed (migration 0011 applied?) · ${key}`);
      if (!w.size) return `${key} · ${assets.length} quote assets in the universe, no reading yet (daily on the 02:15 UTC tick, or ?universe=1)`;
      let newest = 0;
      let hours = 0;
      for (const x of w.values()) {
        newest = Math.max(newest, Date.parse(x.to));
        hours = Math.max(hours, x.hours);
      }
      const ageH = (Date.now() - newest) / 3.6e6;
      const d = await getLatestDeltas();
      const dNote = d === null ? "deltas unreadable (migration 0012 applied?)" : d.size ? `HolderScan deltas for ${d.size} assets (every ${DELTAS_EVERY_DAYS} day${DELTAS_EVERY_DAYS === 1 ? "" : "s"})` : "no HolderScan deltas yet (?deltas=1)";
      const note = `${key} · ${w.size} of ${assets.length} quote assets have a reading, newest ${ageH.toFixed(1)}h ago, ${(hours / 24).toFixed(1)} days of history (every ${UNIVERSE_EVERY_H}h) · ${dNote}`;
      if (ageH > (UNIVERSE_EVERY_H >= 24 ? 36 : Math.max(3, UNIVERSE_EVERY_H * 2))) throw new Error(`${note} — universe_holders step stalled`);
      return note;
    }),
    run("holder_profile", async () => {
      // §6h: STONK's HolderScan profile from holderscan_snapshots — the home page's own read.
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const key = holderscanEnabled() ? `HOLDERSCAN_API_KEY set · plan ${HOLDERSCAN_ADVANCED ? "advanced" : "standard"}` : "HOLDERSCAN_API_KEY unset — the step is skipped";
      const h = await getHolderHistory(STONK_MINT);
      if (!h) return `${key} · no profile stored yet (every ${PROFILE_EVERY_MIN} min, or ?profile=1; migration 0014 applied?)${lastHolderscanError ? ` · last HolderScan error: ${lastHolderscanError}` : ""}`;
      const p = h.latest;
      const ageMin = (Date.now() - Date.parse(p.ts)) / 60000;
      const note = `${key} · ${p.holders} holders, ${p.breakdowns ? `${p.breakdowns.over1k} over $1K` : "no breakdown"}, top-10 ${p.top10Share !== null ? `${(p.top10Share * 100).toFixed(1)}%` : "n/a"}, break-even ${p.pnl?.breakEvenPrice ?? "n/a"} · read ${ageMin.toFixed(0)} min ago, ${(h.hoursOfHistory / 24).toFixed(1)} days of history, ${h.series.length} hourly points${p.errors.length ? ` · missing: ${p.errors.join("; ")}` : ""}`;
      if (ageMin > PROFILE_EVERY_MIN * 3 + 10) throw new Error(`${note} — holder_profile step stalled`);
      return note;
    }),
    run("token_holders", async () => {
      // §6l: live HolderScan profiles on token pages. Per-instance meter: this is what the instance answering this
      // request has spent this hour, not a site-wide total.
      if (!holderscanEnabled()) return "HOLDERSCAN_API_KEY unset — token pages show no holder base";
      const m = pageMeter();
      const note = `budget ${PAGE_UNITS_PER_H} units/h per instance (${Math.floor(PAGE_UNITS_PER_H / TOKEN_PROFILE_UNITS)} reads of ${TOKEN_PROFILE_UNITS}), ${TOKEN_HOLDERS_TTL_MIN} min shared cache · this instance this hour: ${m.reads} reads, ${m.units} units, ${m.refused} refused over budget, ${m.notListed} mints remembered as not listed${m.lastReadAt ? ` · last read ${m.lastReadAt}` : ""}${m.lastError ? ` · last error: ${m.lastError}` : ""}${m.lastMissing ? ` · last partial read: ${m.lastMissing}` : ""}`;
      if (PAGE_UNITS_PER_H === 0) return `${note} — disabled on the Standard plan (set HOLDERSCAN_PAGE_UNITS_PER_H to enable)`;
      return note;
    }),
    run("wallet_rewards", async () => {
      // §6o: the wallet rewards check. Per-instance meter (this instance, this hour) + the stored scans + who pays.
      if (!process.env.HELIUS_API_KEY) throw new Error("HELIUS_API_KEY unset — /rewards/{wallet} cannot read the chain");
      const m = rewardsMeter();
      const dist = await getDistributors();
      const key = distKey(dist);
      const head = `distributors ${[...dist].map((d) => d.slice(0, 6) + "…").join(", ")} · budget ${REWARDS_CREDITS_PER_H} credits/h per instance, refresh ≥${REWARDS_REFRESH_MIN} min · this instance this hour: ${m.scans} scans, ${m.credits} credits, ${m.refused} paused over budget${m.lastScan ? ` · last scan ${m.lastScan}` : ""}${m.lastError ? ` · last error: ${m.lastError}` : ""}`;
      const db = getDb();
      if (!db) return `${head} · no DB (scans are not stored; cards need the DB)`;
      const { data, count, error } = await db.from("wallet_rewards").select("wallet, scanned_at, payouts, error, dist_key, unexplained", { count: "exact" }).order("scanned_at", { ascending: false, nullsFirst: false }).limit(1000);
      if (error) throw new Error(`wallet_rewards unreadable (migrations 0022 + 0023 applied?): ${error.message}`);
      const last = data?.[0];
      const staleRows = (data ?? []).filter((r) => r.scanned_at && r.dist_key !== key).length;
      // A payer this site does not know shows up as the same "unexplained" source across many looked-up wallets.
      const bySource = new Map<string, { wallets: number; txs: number }>();
      for (const r of data ?? []) for (const [src, n] of Object.entries((r.unexplained ?? {}) as Record<string, number>)) {
        if (dist.has(src)) continue;
        const e = bySource.get(src) ?? { wallets: 0, txs: 0 };
        e.wallets++;
        e.txs += n;
        bySource.set(src, e);
      }
      const suspects = [...bySource].filter(([, e]) => e.wallets >= 5 && e.txs >= 50).sort((x, y) => y[1].txs - x[1].txs);
      const { data: dRows } = await db.from("reward_distributors").select("address, last_seen, seen").order("last_seen", { ascending: false });
      const active = dRows?.[0];
      const watch = active ? `latest payer seen by the hourly watch: ${active.address.slice(0, 6)}… at ${active.last_seen}` : "reward_distributors empty (0023 applied? watch runs on the :35 tick)";
      const note = `${head} · ${watch} · ${count ?? 0} wallets stored, ${staleRows} to re-read under the current distributor set${last ? ` · newest ${last.wallet.slice(0, 4)}… ${last.scanned_at ?? "unscanned"}, ${last.payouts} payouts${last.error ? `, error: ${last.error}` : ""}` : ""}`;
      if (suspects.length) throw new Error(`possible unknown distributor: ${suspects.slice(0, 3).map(([s, e]) => `${s} (${e.txs} plain transfers into ${e.wallets} wallets)`).join("; ")} — check it and add it to reward_distributors · ${note}`);
      if (active && Date.now() - Date.parse(active.last_seen) > 3 * 3.6e6) throw new Error(`distributor watch has not seen a payer for ${((Date.now() - Date.parse(active.last_seen)) / 3.6e6).toFixed(1)} h — the :35 step failing, or StonkFun paying in a new shape · ${note}`);
      return note;
    }),
    run("coin_profiles", async () => {
      // §6j: HolderScan profiles of the top coins by market cap — the /holders table's own read.
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const t = await getCoinProfiles(TOP_COINS_SHOWN);
      if (t.status === "db-error") throw new Error("holderscan_snapshots unreadable (migration 0014 applied?)");
      if (!t.newestAt) return `no top-coin profile stored yet (top ${COIN_PROFILES_TOP} every ${COIN_PROFILES_EVERY_H}h on the :25 tick, or ?coinprofiles=1)${lastHolderscanError ? ` · last HolderScan error: ${lastHolderscanError}` : ""}`;
      const ageH = (Date.now() - Date.parse(t.newestAt)) / 3.6e6;
      const withHold = t.rows.filter((r) => r.avgHoldSec !== null).length;
      const spark = Math.max(0, ...t.rows.map((r) => r.series.length));
      const note = `${t.readCount} of ${t.rows.length} top coins have a reading (${withHold} with hold time), newest ${ageH.toFixed(1)}h ago, up to ${spark} hourly points · top: ${t.rows.slice(0, 3).map((r) => `${r.symbol} ${r.holders ?? "—"}`).join(", ")}`;
      if (ageH > COIN_PROFILES_EVERY_H * 3 + 0.5) throw new Error(`${note} — coin_profiles step stalled (every ${COIN_PROFILES_EVERY_H}h)`);
      return note;
    }),
    run("coin_deltas", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const t = await getCoinDeltaTotals();
      if (!t) return `no coin deltas yet (?coindeltas=1; top ${COIN_DELTAS_TOP} coins every ${DELTAS_EVERY_DAYS} days) — or migration 0013 missing`;
      const ageH = (Date.now() - Date.parse(t.ts)) / 3.6e6;
      return `${t.coins} coins, ${t.holdersNow} holders now · ${t.d1 !== null ? `24h ${t.d1 >= 0 ? "+" : ""}${t.d1} · ` : ""}7d ${t.d7 >= 0 ? "+" : ""}${t.d7} · 14d ${t.d14 >= 0 ? "+" : ""}${t.d14} · 30d ${t.d30 >= 0 ? "+" : ""}${t.d30} (holder-slots, HolderScan) · read ${ageH.toFixed(1)}h ago`;
    }),
    run("coin_census", async () => {
      // §6g: distinct wallets holding any reward coin, daily (/api/cron/census?kind=coins).
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const key = process.env.HELIUS_API_KEY ? "HELIUS_API_KEY set" : "HELIUS_API_KEY unset — the census cannot run";
      const c = await getCoinCensus(3);
      if (c.status === "db-error") throw new Error(`coin_census_runs unreadable (migration 0011 applied?) · ${key}`);
      if (!c.latest) return `${key} · no run yet (every ${COIN_CENSUS_EVERY_H}h from the 01:15 UTC tick, or /api/cron/census?kind=coins&sync=1) · budget ${COIN_CENSUS_MAX_PAGES} pages`;
      const l = c.latest;
      const ageH = (Date.now() - Date.parse(l.ts)) / 3.6e6;
      const note = `${key} · last run ${ageH.toFixed(1)}h ago: ${l.wallets} wallets across ${l.coins} of ${l.coinsTotal} coins (${((l.slotsCovered / Math.max(1, l.slotsTotal)) * 100).toFixed(0)}% of holder-slots), ${c.quotes.size} quote assets, ${l.durationMs ? (l.durationMs / 1000).toFixed(0) : "?"}s${l.coinsFailed ? ` · ${l.coinsFailed} coins failed (${l.firstError})` : ""}`;
      if (ageH > Math.max(3, COIN_CENSUS_EVERY_H * 1.5)) throw new Error(`${note} — coin census stalled (every ${COIN_CENSUS_EVERY_H}h)`);
      return note;
    }),
    run("burn_alerts", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const rows = await recentBurnAlerts(db, 1);
      const mode = process.env.SOCIALBU_TOKEN && process.env.SOCIALBU_ACCOUNT_ID ? `posting to SocialBu account ${process.env.SOCIALBU_ACCOUNT_ID}` : "dry-run (SOCIALBU_TOKEN / SOCIALBU_ACCOUNT_ID unset)";
      const last = rows[0] ? `last #${rows[0].id} ${rows[0].status} ${rows[0].amount_tokens.toFixed(0)} STONK at ${rows[0].ts}` : "none yet";
      return `≥$${BURN_ALERT_THRESHOLD_USD} burned (StonkFun pricing) / ${BURN_ALERT_WINDOW_MIN} min, max one post per ${BURN_ALERT_COOLDOWN_MIN} min · ${mode} · ${last}`;
    }),
    run("burn_milestones", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const last = await latestMilestone(db); // throws if migration 0007 is missing
      const mode = process.env.SOCIALBU_TOKEN && process.env.SOCIALBU_ACCOUNT_ID ? "posting" : "dry-run";
      if (!last) return `every 1% of supply · ${mode} · not seeded yet (first tick seeds the current level)`;
      return `every 1% of supply · ${mode} · last ${last.pct}% ${last.status} at ${last.ts} · next post at ${last.pct + 1}%`;
    }),
    run("runners", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      return runnersHealth(db); // throws if migration 0018 is missing
    }),
    run("ath_alerts", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const [high, post] = await Promise.all([highestAth(db), lastAthPost(db)]); // throws if migration 0008 is missing
      const mode = process.env.SOCIALBU_TOKEN && process.env.SOCIALBU_ACCOUNT_ID ? "posting" : "dry-run";
      if (!high) return `market-cap ATH · ${mode} · not seeded yet (first tick seeds StonkFun's peak)`;
      const bar = `bar $${Math.round(high.market_cap_usd).toLocaleString("en-US")} (${high.status}, ${high.source}) at ${high.ts}`;
      const last = post ? `last post #${post.id} ${post.status} at ${post.ts}` : "no post yet";
      return `market-cap ATH · ${mode} · cooldown ${ATH_ALERT_COOLDOWN_MIN} min · ${bar} · ${last}`;
    }),
    run("velocity_alerts", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const [row, post] = await Promise.all([lastVelocityRow(db), lastVelocityPost(db)]); // throws if migration 0016 is missing
      const mode = process.env.SOCIALBU_TOKEN && process.env.SOCIALBU_ACCOUNT_ID ? "posting" : "dry-run";
      const rules = `hot above ${VELOCITY_ALERT_THRESHOLD_PCT}%/day, re-arm below ${VELOCITY_ALERT_REARM_PCT}, cooldown ${VELOCITY_ALERT_COOLDOWN_MIN} min`;
      if (!row) return `burn velocity → X · ${mode} · ${rules} · not seeded yet (first tick seeds the current state)`;
      const state = `${row.state} since ${row.ts} (${row.pct_day.toFixed(2)}%/day, ${row.status})`;
      const last = post ? `last flip #${post.id} ${post.status} at ${post.ts}` : "no hot flip yet";
      return `burn velocity → X · ${mode} · ${rules} · ${state} · ${last}`;
    }),
    run("fire_alerts", async () => {
      const db = getDb();
      if (!db) return "not configured (needs supabase)";
      const [row, post] = await Promise.all([lastVelocityRow(db, "fire_alerts"), lastVelocityPost(db, "fire_alerts")]); // throws if migration 0021 is missing
      const mode = process.env.SOCIALBU_TOKEN && process.env.SOCIALBU_ACCOUNT_ID ? "posting" : "dry-run";
      const rules = `on fire above ${FIRE_ALERT_THRESHOLD_PCT}%/day, re-arm below ${FIRE_ALERT_REARM_PCT}, cooldown ${FIRE_ALERT_COOLDOWN_MIN} min, supersedes heating-up`;
      if (!row) return `burns on fire → X · ${mode} · ${rules} · not seeded yet (first tick seeds the current state)`;
      const state = `${row.state} since ${row.ts} (${row.pct_day.toFixed(2)}%/day, ${row.status})`;
      const last = post ? `last flip #${post.id} ${post.status} at ${post.ts}` : "no on-fire flip yet";
      return `burns on fire → X · ${mode} · ${rules} · ${state} · ${last}`;
    }),
  ]);

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, dataSource: process.env.DATA_SOURCE ?? "live", checks }, { status: ok ? 200 : 503 });
}
