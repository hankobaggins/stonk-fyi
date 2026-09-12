import Link from "next/link";
import { CATEGORY_ORDER, categoryLabel, getUniverseTable, UNIVERSE_EVERY_H } from "@/lib/universe";
import { fmtNum, nowMs, timeAgo } from "@/lib/format";
import { resolveImage } from "@/lib/api";
import WalletCensus from "@/components/WalletCensus";
import EcosystemWallets from "@/components/EcosystemWallets";
import UniverseTable, { type UniverseRowView } from "@/components/UniverseTable";
import { COIN_CENSUS_EVERY_H, getWalletCensus, WALLET_CENSUS_EVERY_H } from "@/lib/wallets";

import { Empty, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Holders across the StonkFun ecosystem" };

const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

export default async function HoldersPage() {
  const now = nowMs();
  const [u, census] = await Promise.all([getUniverseTable(), getWalletCensus()]);

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
  const growth = u.coinDeltas ? { ts: u.coinDeltas.ts, coins: u.coinDeltas.coins, holdersNow: u.coinDeltas.holdersNow, d7: u.coinDeltas.d7, d14: u.coinDeltas.d14, d30: u.coinDeltas.d30, slotsTotal } : null;
  const uReadAt = u.rows.map((r) => r.readAt).filter(Boolean).sort().pop() ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Holders across the StonkFun ecosystem"
        sub={`Every quote asset with a StonkFun reward coin launched against it — ${u.rows.length} assets in ${cats.length} categories — with its holder count, the wallets StonkFun pays it to, and how both move.`}
      >
        <div className="text-right text-xs text-secondary num space-y-0.5">
          <div><span className="pill up">unique holders</span></div>
          <div>Market snapshot: {dmy(u.generatedAt)} · {hhmm(u.generatedAt)}</div>
          {uReadAt && <div>Newest HolderScan reading {timeAgo(uReadAt, now)}</div>}
        </div>
      </PageHeader>

      {u.status === "no-db" && <Empty>This page needs the site&apos;s holder readings and census runs (Postgres), which this deployment does not have.</Empty>}
      {u.status === "db-error" && <Empty>The universe readings could not be read just now. Check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → universe_holders and coin_census.</Empty>}

      <Section
        title="Wallets holding a StonkFun reward coin"
        action={<span className="num text-xs text-muted">Helius on-chain · stonk.fyi census · {COIN_CENSUS_EVERY_H >= 24 ? "daily" : `every ${COIN_CENSUS_EVERY_H}h`}</span>}
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
        <p className="mt-3 text-secondary text-[13px] leading-relaxed">
          This is the ecosystem&apos;s holder base: each of these wallets holds a reward-mode coin and is paid that coin&apos;s quote asset on every payout, so every one of them is a holder StonkFun created or keeps for some project&apos;s token. One wallet holding several coins counts once. The census covers the largest coins up to a fixed budget and says how much of the ledger that is; the true figure is at least this large. Program-owned accounts (pool vaults) are counted like any owner.
        </p>
      </Section>

      {cats.length > 0 && (
        <div className="kpis">
          {cats.map((c) => (
            <div key={c.key} className="kpi min-w-0">
              <div className="label">{c.label}</div>
              <div className="mt-2 text-[26px] leading-tight font-medium num truncate tracking-tight">{c.wallets === null ? <span className="text-base text-muted">{latestRun ? "not covered" : "—"}</span> : fmtNum(c.wallets)}</div>
              <div className="mt-1.5 text-xs text-secondary num space-y-0.5">
                <div>
                  StonkFun wallets
                  {c.walletsD1 !== null && <span className={c.walletsD1 > 0 ? " text-up" : c.walletsD1 < 0 ? " text-down" : ""}> {signed(c.walletsD1)} 24h</span>}
                </div>
                <div className="text-muted">{fmtNum(c.assets)} quote asset{c.assets === 1 ? "" : "s"} · {fmtNum(c.coins)} coin{c.coins === 1 ? "" : "s"} · {fmtNum(c.slots)} holder-slots</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Section
        title="Wallets holding a stock token"
        action={<span className="num text-xs text-muted">Helius on-chain · stonk.fyi census · every {WALLET_CENSUS_EVERY_H}h</span>}
      >
        {census.status === "no-db" && <Empty>This block needs the site&apos;s census runs (Postgres), which this deployment does not have.</Empty>}
        {census.status === "db-error" && <Empty>The census could not be read just now. Check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → wallet_census.</Empty>}
        {census.status === "empty" && <Empty>No census run stored yet. The worker counts every wallet holding any of the {census.quoteAssets} stock quote assets every {WALLET_CENSUS_EVERY_H} hours; the first run appears here, the 24h change after a day, 7d after six, 30d after 24.</Empty>}
        {census.status === "ok" && <WalletCensus runs={census.runs} latest={census.latest} quoteAssets={census.quoteAssets} now={now} />}
        <p className="mt-3 text-secondary text-[13px] leading-relaxed">
          The other side of the tokenized-stock market: one wallet = one owner address with a non-zero balance of any selected stock quote asset (xStocks, Backpack, pre-stocks, Tessera), counted directly from token accounts on Solana; a wallet holding several counts once. Holding the stock token itself, not a StonkFun coin — so this is a different population from the reward-coin headline above, and neither contains the other. The per-asset figures are the &ldquo;On-chain&rdquo; column in the table.
        </p>
      </Section>

      <Section
        title={`${u.rows.length} quote assets`}
        action={<span className="num text-xs text-muted">HolderScan · {UNIVERSE_EVERY_H === 1 ? "hourly" : UNIVERSE_EVERY_H >= 24 ? "daily" : `every ${UNIVERSE_EVERY_H}h`} · Helius on-chain · every {WALLET_CENSUS_EVERY_H}h · reward-coin census · {COIN_CENSUS_EVERY_H >= 24 ? "daily" : `every ${COIN_CENSUS_EVERY_H}h`}</span>}
      >
        {u.readCount === 0 && u.census.status !== "ok" && (
          <Empty>
            Collecting: no HolderScan reading stored yet. Readings are taken {UNIVERSE_EVERY_H === 1 ? "every hour on the :15 tick; the 24h column appears after about 20 hours, 7d after six days, 30d after 24" : "once a day (02:15 UTC); the 24h column appears after two, 7d after six, 30d after 24"}. {u.rows.length} quote assets are tracked.
          </Empty>
        )}
        <UniverseTable rows={uRows} categories={cats.map((c) => ({ key: c.key, label: c.label }))} now={now} />
        <div className="mt-4 pt-4 border-t border-border text-sm space-y-1.5 leading-relaxed">
          <p className="font-medium">Per project: three counts of one asset&apos;s wallets — its holders (HolderScan), its holders counted on-chain by this site, and how many of them hold a StonkFun coin that pays them the asset.</p>
          <p className="text-secondary text-[13px]">Holders: HolderScan&apos;s count of wallets with any balance of the asset, on any venue, read {UNIVERSE_EVERY_H === 1 ? "every hour" : "once a day"}{u.readCount < u.rows.length ? ` (${u.readCount} of ${u.rows.length} assets have a reading; the rest are not tracked by HolderScan yet)` : ""}. On-chain: this site&apos;s own count of owner addresses with a non-zero balance of the asset, from token accounts via Helius every {WALLET_CENSUS_EVERY_H} hours{u.onchainCount ? ` (${u.onchainCount} of ${u.rows.length} assets)` : ""}; a &ldquo;≥&rdquo; marks an asset with more token accounts than one run reads, so its figure is a floor — the two holder columns count the same thing two ways and should agree within dust. StonkFun wallets: this site&apos;s {COIN_CENSUS_EVERY_H >= 24 ? "daily" : `${COIN_CENSUS_EVERY_H}-hourly`} on-chain census of wallets holding a reward coin quoted in the asset, de-duplicated within the asset; a &ldquo;+&rdquo; marks an asset whose smaller coins fall outside the census budget, so its figure is a floor. StonkFun share divides the second by the first: TTWO at 75% means three in four TTWO holders hold a StonkFun coin that pays them TTWO. A small &ldquo;HS&rdquo; after a change figure means it is HolderScan&apos;s own change for that window{u.deltaCount ? ` (${u.deltaCount} assets today)` : ""}; this site&apos;s own readings replace it once they cover the window (a 24h figure is only borrowed from a delta read in the last 36 hours). Holder-slots is StonkFun&apos;s own reward-eligible count summed over the asset&apos;s coins (one slot per coin per wallet). The category tiles are de-duplicated within each category; adding them up over-counts wallets that hold coins on several categories — the headline above is the only cross-category figure.</p>
          <div className="flex flex-wrap justify-between gap-2 pt-1 text-xs text-muted num">
            <span>Sources: HolderScan · Helius on-chain · StonkFun rewards ledger · StonkFun pairs</span>
            <span>A change column shows once readings cover 80% of its window; empty columns are hidden until then</span>
          </div>
        </div>
      </Section>

      <p className="text-xs text-muted">
        Method on <Link href="/about#holders" className="underline underline-offset-2 hover:text-primary">the About page</Link>. Not financial advice.
      </p>
    </div>
  );
}
