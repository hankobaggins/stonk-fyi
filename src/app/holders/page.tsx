import Link from "next/link";
import { CATEGORY_ORDER, categoryLabel, getUniverseTable, UNIVERSE_EVERY_H, type UniverseRow } from "@/lib/universe";
import { fmtNum, nowMs, timeAgo } from "@/lib/format";
import { resolveImage } from "@/lib/api";
import WalletCensus, { type StockHsView } from "@/components/WalletCensus";
import { STOCK_CATEGORIES } from "@/lib/holders";
import EcosystemWallets from "@/components/EcosystemWallets";
import TopCoins from "@/components/TopCoins";
import { COIN_PROFILES_EVERY_H, getCoinProfiles, TOP_COINS_SHOWN } from "@/lib/coin-profiles";
import UniverseTable, { type UniverseRowView } from "@/components/UniverseTable";
import { COIN_CENSUS_EVERY_H, getWalletCensus, WALLET_CENSUS_EVERY_H } from "@/lib/wallets";

import { Empty, PageHeader, Section } from "@/components/ui";
import Populations, { Swatch } from "@/components/Populations";
import MethodStrip from "@/components/MethodStrip";

export const dynamic = "force-dynamic";
export const metadata = { title: "Holders across the StonkFun ecosystem" };

const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

export default async function HoldersPage() {
  const now = nowMs();
  const [u, census, top] = await Promise.all([getUniverseTable(), getWalletCensus(), getCoinProfiles(TOP_COINS_SHOWN)]);

  // ---- the whole universe (§6g) ----
  const uRows: UniverseRowView[] = u.rows.map((r) => ({ ...r, logoUrl: resolveImage(r.logoUrl) }));
  const catKeys = [...new Set(u.rows.map((r) => r.category))].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const cats = catKeys.map((key) => {
    const rows = u.rows.filter((r) => r.category === key);
    const c = u.census.categories.get(key);
    return {
      key,
      label: categoryLabel(key),
      assets: rows.length,
      coins: rows.reduce((a, r) => a + r.coins, 0),
      slots: rows.reduce((a, r) => a + r.slots, 0),
      wallets: c?.wallets ?? null,
      walletsD1: c?.d1 ?? null,
      read: rows.filter((r) => r.holders !== null).length,
    };
  });
  const latestRun = u.census.latest;
  const slotsTotal = u.rows.reduce((a, r) => a + r.slots, 0);
  const growth = u.coinDeltas ? { ts: u.coinDeltas.ts, coins: u.coinDeltas.coins, holdersNow: u.coinDeltas.holdersNow, d1: now - Date.parse(u.coinDeltas.ts) < 36 * 3.6e6 ? u.coinDeltas.d1 : null, d7: u.coinDeltas.d7, d14: u.coinDeltas.d14, d30: u.coinDeltas.d30, slotsTotal } : null;
  const uReadAt = u.rows.map((r) => r.readAt).filter(Boolean).sort().pop() ?? null;

  // HolderScan's own deltas summed per stock issuer (bit = index in STOCK_CATEGORIES, as the census masks): the
  // stock-token block's 7d / 30d backfill until its own runs cover the window. Holder-slots per asset, not wallets.
  const stockHs: StockHsView[] = STOCK_CATEGORIES.map((cat, i) => {
    const rows = u.rows.filter((r) => r.category === cat);
    const tracked = rows.filter((r) => r.hs);
    const sum = (pick: (h: NonNullable<UniverseRow["hs"]>) => number | null) => {
      const vals = tracked.map((r) => pick(r.hs!)).filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    const holders = tracked.reduce((a, r) => a + (r.holders ?? 0), 0);
    return { bit: 1 << i, assets: rows.length, tracked: tracked.length, holders, d1: sum((h) => h.d1), d7: sum((h) => h.d7), d30: sum((h) => h.d30), ts: tracked.map((r) => r.hs!.ts).sort().pop() ?? null };
  });

  // The three populations on one scale. On-chain and HolderScan are per-asset counts summed over the universe (a
  // wallet holding two assets counts twice, so "token accounts"); StonkFun-paid is the census's de-duplicated figure.
  const onchainRows = u.rows.filter((r) => r.onchain !== null);
  const hsRows = u.rows.filter((r) => r.holders !== null);
  const pops = [
    { key: "onchain" as const, value: onchainRows.length ? onchainRows.reduce((a, r) => a + (r.onchain ?? 0), 0) : null, floor: true, detail: `token accounts · ${onchainRows.length} assets`, src: `Helius · census every ${WALLET_CENSUS_EVERY_H}h`, def: "Every account with a non-zero balance of the quote asset, whoever they are. A floor: the census stops at a page limit." },
    { key: "holderscan" as const, value: hsRows.length ? hsRows.reduce((a, r) => a + (r.holders ?? 0), 0) : null, detail: `holder-slots · ${hsRows.length} tracked assets`, src: `HolderScan · ${UNIVERSE_EVERY_H === 1 ? "hourly" : "daily"}`, def: "The provider's de-duplicated count per asset, only for the assets it tracks. Lower than on-chain by construction." },
    { key: "paid" as const, value: latestRun?.wallets ?? null, detail: "unique wallets", src: `StonkFun rewards · census every ${COIN_CENSUS_EVERY_H}h`, def: "Wallets that received at least one reward payout. The only figure that says something about StonkFun itself." },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Holders across the StonkFun ecosystem"
        sub={`Every quote asset with a StonkFun reward coin launched against it — ${u.rows.length} assets in ${cats.length} categories — with its holder count, the wallets StonkFun pays it to, and how both move.`}
      >
        <div className="num flex flex-col items-end gap-1.5 text-[11px] text-muted whitespace-nowrap">
          <span className="pill up">unique holders</span>
          <span>Market snapshot: {dmy(u.generatedAt)} · {hhmm(u.generatedAt)}</span>
          {uReadAt && <span>Newest HolderScan reading {timeAgo(uReadAt, now)}</span>}
        </div>
      </PageHeader>

      {u.status !== "no-db" && u.status !== "db-error" && <Populations pops={pops} />}

      {u.status === "no-db" && <Empty>This page needs the site&apos;s holder readings and census runs (Postgres), which this deployment does not have.</Empty>}
      {u.status === "db-error" && <Empty>The universe readings could not be read just now. Check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → universe_holders and coin_census.</Empty>}

      <Section
        title={<><Swatch p="paid" lg />Wallets holding a StonkFun reward coin</>}
        action={<span className="num text-[11px] text-muted">Helius on-chain · stonk.fyi census · {COIN_CENSUS_EVERY_H >= 24 ? "daily" : `every ${COIN_CENSUS_EVERY_H}h`}</span>}
      >
        {u.census.status === "ok" || growth ? (
          <EcosystemWallets runs={u.census.status === "ok" ? u.census.runs : []} growth={growth} now={now} everyH={COIN_CENSUS_EVERY_H} />
        ) : (
          <Empty>
            {u.census.status === "empty" || u.census.status === "no-db"
              ? `No reward-coin census stored yet. It runs ${COIN_CENSUS_EVERY_H >= 24 ? "once a day (01:15 UTC)" : `every ${COIN_CENSUS_EVERY_H} hours from 01:15 UTC`}: every wallet holding one of the largest reward coins by holder count, de-duplicated across coins. The first run appears here, the chart from the second, then the 24h, 7d and 30d changes as runs cover each window.`
              : "The census could not be read just now."}
          </Empty>
        )}
        <MethodStrip lead="Each of these wallets holds a reward-mode coin and is paid that coin's quote asset on every payout. A wallet is counted once no matter how many coins it holds." href="/about#holders">
          <div className="method-body">
            <p>This is the ecosystem&apos;s holder base: every one of these wallets is a holder StonkFun created or keeps for some project&apos;s token. The census de-duplicates across all covered coins.</p>
            <p>The census covers the largest coins up to a fixed budget and says how much of the ledger that is; the true figure is at least this large. Program-owned accounts (pool vaults) are counted like any owner.</p>
          </div>
        </MethodStrip>
      </Section>

      {cats.length > 0 && (
        <div className="kpis cols-5">
          {cats.map((c) => (
            <div key={c.key} className="kpi min-w-0">
              <div className="label">{c.label}</div>
              <div className={`mt-2 text-[26px] leading-tight font-medium num truncate tracking-tight ${c.wallets === null ? "text-muted" : ""}`}>{c.wallets === null ? <span className="text-base">{latestRun ? "not covered" : "—"}</span> : fmtNum(c.wallets)}</div>
              <div className="mt-1.5 text-xs text-secondary num space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Swatch p="paid" />StonkFun wallets
                  {c.walletsD1 !== null && <span className={c.walletsD1 > 0 ? "text-up" : c.walletsD1 < 0 ? "text-down" : ""}>{signed(c.walletsD1)} 24h</span>}
                </div>
                <div className="text-muted">{fmtNum(c.assets)} quote asset{c.assets === 1 ? "" : "s"} · {fmtNum(c.coins)} coin{c.coins === 1 ? "" : "s"} · {fmtNum(c.slots)} holder-slots</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Section
        title={<><Swatch p="holderscan" lg />Top {TOP_COINS_SHOWN} coins by market cap: holders over time</>}
        action={<span className="num text-[11px] text-muted">HolderScan · {COIN_PROFILES_EVERY_H === 1 ? "hourly" : `every ${COIN_PROFILES_EVERY_H}h`}{top.newestAt ? ` · read ${timeAgo(top.newestAt, now)}` : ""}</span>}
      >
        {top.status === "no-db" && <Empty>This block needs the site&apos;s stored HolderScan readings (Postgres), which this deployment does not have.</Empty>}
        {top.status === "db-error" && <Empty>The coin profiles could not be read just now. Check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → coin_profiles.</Empty>}
        {top.status === "collecting" && <Empty>Collecting: no HolderScan reading stored for the current top {TOP_COINS_SHOWN} yet. The worker reads them {COIN_PROFILES_EVERY_H === 1 ? "every hour on the :25 tick" : `every ${COIN_PROFILES_EVERY_H} hours from 00:25 UTC`}; the 24h, 7d and 30d columns come from HolderScan&apos;s own history, so they show from the first read.</Empty>}
        {top.status === "ok" && <TopCoins rows={top.rows} now={now} everyH={COIN_PROFILES_EVERY_H} />}
        <MethodStrip
          lead="The ten largest launched coins right now, ranked by StonkFun market cap, with HolderScan's holder count and its own 24h / 7d / 30d change — backdated from the first read — and the average time current holders have held."
          note={top.readCount < top.rows.length && top.status === "ok" ? `${top.rows.length - top.readCount} of ${top.rows.length} without a reading yet` : undefined}
          href="/about#holders"
        >
          <div className="method-body">
            <p><Swatch p="holderscan" /> Holders is HolderScan&apos;s de-duplicated count of wallets with any balance, read {COIN_PROFILES_EVERY_H === 1 ? "every hour" : `every ${COIN_PROFILES_EVERY_H} hours`} for the largest coins by market cap (STONK has its own holder base on the home page). The change columns are HolderScan&apos;s own deltas as of that reading — percent against the count at the window start — so they do not wait for this site&apos;s history; a coin younger than a window shows &ldquo;—&rdquo;. Avg hold is HolderScan&apos;s average time held by current holders (n/a where it has not profiled the coin). The sparkline is this site&apos;s own hourly readings over the last 7 days and fills in as they accumulate. <Swatch p="paid" /> StonkFun-paid is StonkFun&apos;s reward-eligible holder count, live, for reward-mode coins only.</p>
            <p>The set is live: a coin that climbs into the top {TOP_COINS_SHOWN} between reads shows &ldquo;next read in …&rdquo; until the worker has profiled it (it reads the top {COIN_PROFILES_EVERY_H === 1 ? "20" : "10"}, so this is rare).</p>
          </div>
        </MethodStrip>
      </Section>

      <Section
        title={<><Swatch p="onchain" lg />Wallets holding a stock token</>}
        action={<span className="num text-[11px] text-muted">Helius on-chain · stonk.fyi census · every {WALLET_CENSUS_EVERY_H}h</span>}
      >
        {census.status === "no-db" && <Empty>This block needs the site&apos;s census runs (Postgres), which this deployment does not have.</Empty>}
        {census.status === "db-error" && <Empty>The census could not be read just now. Check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → wallet_census.</Empty>}
        {census.status === "empty" && <Empty>No census run stored yet. The worker counts every wallet holding any of the {census.quoteAssets} stock quote assets every {WALLET_CENSUS_EVERY_H} hours; the first run appears here, the 24h change after a day, 7d after six, 30d after 24.</Empty>}
        {census.status === "ok" && <WalletCensus runs={census.runs} latest={census.latest} quoteAssets={census.quoteAssets} now={now} hs={stockHs} />}
        <MethodStrip lead="One wallet = one owner address with a balance of any selected stock asset, counted from token accounts on Solana. Holding the stock, not a StonkFun coin: a different population from the headline above." href="/about#holders">
          <div className="method-body">
            <p>The other side of the tokenized-stock market: every owner address with a non-zero balance of any selected stock quote asset (xStocks, Backpack, pre-stocks, Tessera); a wallet holding several counts once. Any issuer subset can be selected above.</p>
            <p>Neither population contains the other. The per-asset figures are the &ldquo;On-chain&rdquo; column in the table below; a &ldquo;≥&rdquo; marks an asset with more token accounts than one run reads.</p>
          </div>
        </MethodStrip>
      </Section>

      <Section
        title={`${u.rows.length} quote assets`}
        action={<span className="num text-[11px] text-muted">click a column to sort · HolderScan · {UNIVERSE_EVERY_H === 1 ? "hourly" : UNIVERSE_EVERY_H >= 24 ? "daily" : `every ${UNIVERSE_EVERY_H}h`} · Helius · {WALLET_CENSUS_EVERY_H}h · StonkFun census · {COIN_CENSUS_EVERY_H >= 24 ? "daily" : `${COIN_CENSUS_EVERY_H}h`}</span>}
      >
        {u.readCount === 0 && u.census.status !== "ok" && (
          <Empty>
            Collecting: no HolderScan reading stored yet. Readings are taken {UNIVERSE_EVERY_H === 1 ? "every hour on the :15 tick; the 24h column appears after about 20 hours, 7d after six days, 30d after 24" : "once a day (02:15 UTC); the 24h column appears after two, 7d after six, 30d after 24"}. {u.rows.length} quote assets are tracked.
          </Empty>
        )}
        <UniverseTable rows={uRows} categories={cats.map((c) => ({ key: c.key, label: c.label }))} now={now} />
        <MethodStrip
          lead="On-chain counts are floors; HolderScan counts are that provider's; StonkFun wallets are the wallets paid at least once. Three counts of one asset's wallets, never summed."
          note={<><sup>HS</sup> = change borrowed from HolderScan until the census has history{u.deltaCount ? ` (${u.deltaCount} assets today)` : ""}</>}
          href="/about#holders"
        >
          <div className="method-body">
            <p><Swatch p="holderscan" /> Holders is HolderScan&apos;s de-duplicated count of wallets with any balance of the asset, on any venue, read {UNIVERSE_EVERY_H === 1 ? "every hour" : "once a day"}{u.readCount < u.rows.length ? ` (${u.readCount} of ${u.rows.length} assets have a reading; the rest are not tracked by HolderScan yet)` : ""}. <Swatch p="onchain" /> On-chain is this site&apos;s own count of owner addresses with a non-zero balance, from token accounts via Helius every {WALLET_CENSUS_EVERY_H} hours{u.onchainCount ? ` (${u.onchainCount} of ${u.rows.length} assets)` : ""}; it scans the largest accounts first and stops at a page limit, so a &ldquo;≥&rdquo; marks a floor. The two count the same thing two ways and should agree within dust.</p>
            <p><Swatch p="paid" /> StonkFun wallets are the distinct wallets that received at least one reward payout in the asset, from the {COIN_CENSUS_EVERY_H >= 24 ? "daily" : `${COIN_CENSUS_EVERY_H}-hourly`} census; a &ldquo;+&rdquo; marks an asset whose smaller coins fall outside the census budget. StonkFun share = StonkFun wallets ÷ holders: TTWO at 75% means three in four TTWO holders hold a StonkFun coin that pays them TTWO. Change cells compare the newest reading to the one nearest the window start and show once readings cover 80% of the window; until then a StonkFun-wallet change may borrow HolderScan&apos;s direction, marked HS. Holder-slots is StonkFun&apos;s reward-eligible count summed over the asset&apos;s coins. Category tiles are de-duplicated within each category; adding them up over-counts wallets on several categories — the headline is the only cross-category figure.</p>
          </div>
        </MethodStrip>
      </Section>

      <p className="num text-xs text-muted">
        Definitions and known gaps → <Link href="/about#holders" className="text-secondary hover:text-primary">About · Holders across the ecosystem</Link>
      </p>
    </div>
  );
}
