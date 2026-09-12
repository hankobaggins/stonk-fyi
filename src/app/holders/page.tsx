import Link from "next/link";
import { CATEGORY_LABEL, getHoldersTable, HOLDERS_TRACKED, STOCK_CATEGORIES } from "@/lib/holders";
import { CATEGORY_ORDER, categoryLabel, getUniverseTable } from "@/lib/universe";
import { fmtNum, fmtUsd, nowMs, timeAgo } from "@/lib/format";
import { resolveImage } from "@/lib/api";
import HoldersTable, { type HolderRow } from "@/components/HoldersTable";
import WalletCensus from "@/components/WalletCensus";
import EcosystemWallets from "@/components/EcosystemWallets";
import UniverseTable, { type UniverseRowView } from "@/components/UniverseTable";
import { getWalletCensus, WALLET_CENSUS_EVERY_H } from "@/lib/wallets";
import { Empty, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Holders across the StonkFun ecosystem" };

const hhmm = (iso: string) => iso.slice(11, 16) + " UTC";
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const signed = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

export default async function HoldersPage() {
  const now = nowMs();
  const [u, t, census] = await Promise.all([getUniverseTable(), getHoldersTable(), getWalletCensus()]);

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
  const uReadAt = u.rows.map((r) => r.readAt).filter(Boolean).sort().pop() ?? null;

  // ---- stock-quoted side (§6e / §6f), unchanged ----
  const reads = t.quotes.map((q) => q.readAt).filter(Boolean) as string[];
  const lastRead = reads.length ? reads.sort()[reads.length - 1] : null;
  const withReading = t.quotes.filter((q) => q.holders !== null).length;
  const rows: HolderRow[] = [
    ...t.quotes.map<HolderRow>((q) => ({
      mint: q.mint,
      kind: "quote",
      symbol: q.symbol,
      name: q.name,
      logoUrl: resolveImage(q.logoUrl),
      provider: q.categoryLabel,
      marketCapUsd: null,
      holders: q.holders,
      d1: q.d1,
      d7: q.d7,
      at: q.readAt,
      href: `https://gmgn.ai/sol/token/${q.mint}`,
      external: true,
    })),
    ...t.coins.map<HolderRow>((c) => ({
      mint: c.mint,
      kind: "coin",
      symbol: c.symbol,
      name: c.name,
      provider: CATEGORY_LABEL[c.quoteCategory] ?? c.quoteCategory,
      quoteSymbol: c.quoteSymbol,
      marketCapUsd: c.marketCapUsd,
      holders: c.holders,
      d1: c.d1,
      d7: c.d7,
      at: c.createdAt,
      href: `/tokens/${c.mint}`,
      external: false,
    })),
  ];
  const issuers = STOCK_CATEGORIES.map((cat) => {
    const coins = t.coins.filter((c) => c.quoteCategory === cat);
    const quotes = t.quotes.filter((q) => q.category === cat);
    const read = quotes.filter((q) => q.holders !== null);
    const coinD1 = coins.filter((c) => c.d1);
    return {
      cat,
      label: CATEGORY_LABEL[cat],
      coins: coins.length,
      mcap: coins.reduce((a, c) => a + c.marketCapUsd, 0),
      coinHolders: coins.reduce((a, c) => a + c.holders, 0),
      coinHolders24h: coinD1.length ? coinD1.reduce((a, c) => a + c.d1!.abs, 0) : null,
      quotes: quotes.length,
      quotesRead: read.length,
      quoteHolders: read.reduce((a, q) => a + (q.holders ?? 0), 0),
    };
  });

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
        action={<span className="num text-xs text-muted">Helius on-chain · stonk.fyi census · daily</span>}
      >
        {u.census.status === "ok" ? (
          <EcosystemWallets runs={u.census.runs} now={now} />
        ) : (
          <Empty>
            {u.census.status === "empty" || u.census.status === "no-db"
              ? `No reward-coin census stored yet. It runs once a day (01:15 UTC): every wallet holding one of the largest reward coins by holder count, de-duplicated across coins. The first run appears here, the 24h change after two, 7d after six, 30d after 24.`
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
              <div className="mt-2 text-[26px] leading-tight font-medium num truncate tracking-tight">{c.wallets === null ? <span className="text-base text-muted">{latestRun ? "not covered" : "collecting"}</span> : fmtNum(c.wallets)}</div>
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
        title={`${u.rows.length} quote assets`}
        action={<span className="num text-xs text-muted">HolderScan holder count · daily · stonk.fyi census · daily</span>}
      >
        {u.readCount === 0 && u.census.status !== "ok" && (
          <Empty>
            Collecting: no HolderScan reading stored yet. Readings are taken once a day (02:15 UTC); the 24h column appears after two, 7d after six, 30d after 24. {u.rows.length} quote assets are tracked.
          </Empty>
        )}
        <UniverseTable rows={uRows} categories={cats.map((c) => ({ key: c.key, label: c.label }))} now={now} />
        <div className="mt-4 pt-4 border-t border-border text-sm space-y-1.5 leading-relaxed">
          <p className="font-medium">Per project: of an asset&apos;s holders, how many hold a StonkFun coin that pays them the asset — and whether both are growing.</p>
          <p className="text-secondary text-[13px]">Holders: HolderScan&apos;s count of wallets with any balance of the asset, on any venue, read once a day{u.readCount < u.rows.length ? ` (${u.readCount} of ${u.rows.length} assets have a reading; the rest are not tracked by HolderScan yet)` : ""}. StonkFun wallets: this site&apos;s daily on-chain census of wallets holding a reward coin quoted in the asset, de-duplicated within the asset; a &ldquo;+&rdquo; marks an asset whose smaller coins fall outside the census budget, so its figure is a floor. Share divides the second by the first. A small &ldquo;HS&rdquo; after a 7d or 30d figure means it is HolderScan&apos;s own change for that window{u.deltaCount ? ` (${u.deltaCount} assets today)` : ""}; this site&apos;s daily readings replace it once they cover the window, and the 24h column only ever comes from those readings. Holder-slots is StonkFun&apos;s own reward-eligible count summed over the asset&apos;s coins (one slot per coin per wallet). The category tiles are de-duplicated within each category; adding them up over-counts wallets that hold coins on several categories — the headline above is the only cross-category figure.</p>
          <div className="flex flex-wrap justify-between gap-2 pt-1 text-xs text-muted num">
            <span>Sources: HolderScan · Helius · StonkFun rewards ledger · StonkFun pairs</span>
            <span>Change columns appear once readings cover 80% of the window</span>
          </div>
        </div>
      </Section>

      <Section
        title="Stock-quoted assets, hourly"
        action={<span className="num text-xs text-muted">GMGN · StonkFun rewards ledger · stonk.fyi snapshots · hourly</span>}
      >
        <p className="text-secondary text-[13px] leading-relaxed mb-4">
          The tokenized-stock side (xStocks, Backpack, pre-stocks, Tessera) is read every hour rather than daily, with a separate on-chain census of wallets holding the quote assets themselves. {lastRead ? `Newest reading ${timeAgo(lastRead, now)}.` : ""}
        </p>

        {t.status === "no-db" && <Empty>This block needs the site&apos;s holder snapshots (Postgres), which this deployment does not have.</Empty>}
        {t.status === "db-error" && <Empty>The hourly holder readings could not be read just now. Check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → holder_windows.</Empty>}
        {t.status === "collecting" && (
          <Empty>
            Collecting hourly holder readings: none stored yet. The 24h column appears after about 20 hours, the 7-day column after about 5½ days.
            {t.quotes.length > 0 && <> {t.quotes.length} quote assets and {t.coins.length} coins are being tracked.</>}
          </Empty>
        )}

        <h3 className="text-sm font-medium mb-2">Unique wallets holding at least one stock quote asset <span className="num text-xs text-muted font-normal">· Helius on-chain · every {WALLET_CENSUS_EVERY_H}h</span></h3>
        {census.status === "no-db" && <Empty>This block needs the site&apos;s census runs (Postgres), which this deployment does not have.</Empty>}
        {census.status === "db-error" && <Empty>The census could not be read just now. Check <Link href="/api/health" className="underline underline-offset-2">/api/health</Link> → wallet_census.</Empty>}
        {census.status === "empty" && <Empty>No census run stored yet. The worker counts every wallet holding any of the {census.quoteAssets} stock quote assets every {WALLET_CENSUS_EVERY_H} hours; the first run appears here, the 24h change after a day, 7d after six, 30d after 24.</Empty>}
        {census.status === "ok" && <WalletCensus runs={census.runs} latest={census.latest} quoteAssets={census.quoteAssets} now={now} />}
        <p className="mt-3 mb-5 text-secondary text-[13px] leading-relaxed">
          One wallet = one owner address with a non-zero balance of any selected quote asset, counted directly from token accounts on Solana; a wallet holding several assets counts once. This is a different measure from the reward-coin census above (holding the stock token itself vs. holding a coin that pays it) and from the per-asset counts below.
        </p>

        {t.status === "ok" && (
          <div className="kpis mb-5">
            {issuers.map((x) => (
              <div key={x.cat} className="kpi min-w-0">
                <div className="label">{x.label}</div>
                <div className="mt-2 text-[26px] leading-tight font-medium num truncate tracking-tight">{x.coins ? fmtUsd(x.mcap, { compact: true }) : "—"}</div>
                <div className="mt-1.5 text-xs text-secondary num space-y-0.5">
                  <div>{x.coins ? <>{fmtNum(x.coins)} tracked coin{x.coins === 1 ? "" : "s"} · {fmtNum(x.coinHolders)} holders{x.coinHolders24h !== null && <span className={x.coinHolders24h > 0 ? " text-up" : x.coinHolders24h < 0 ? " text-down" : ""}> {signed(x.coinHolders24h)} 24h</span>}</> : "no tracked coins"}</div>
                  <div className="text-muted">{fmtNum(x.quotes)} quote asset{x.quotes === 1 ? "" : "s"} · {x.quotesRead ? <>{fmtNum(x.quoteHolders)} holders across {x.quotesRead} read</> : "no readings"}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {t.status === "ok" && (
          <>
            <h3 className="text-sm font-medium mb-2">{t.quotes.length} quote assets · {t.coins.length} coins <span className="num text-xs text-muted font-normal">· hourly</span></h3>
            <HoldersTable rows={rows} now={now} />
            <div className="mt-4 pt-4 border-t border-border text-sm space-y-1.5 leading-relaxed">
              <p className="font-medium">The two kinds of row count holders differently. Sort within a kind, or compare a row with itself over time.</p>
              <p className="text-secondary text-[13px]">Quote assets: GMGN&apos;s holder count for the mint, every wallet with a balance across all venues, read hourly; assets GMGN does not index show no reading ({withReading} of {t.quotes.length} have one). Coins: StonkFun&apos;s own count of reward-eligible wallets from its rewards ledger, live, with changes from this site&apos;s hourly readings; only reward-mode coins carry a holder figure. Market cap is shown for coins only. The issuer tiles sum the {HOLDERS_TRACKED} largest tracked coins by market cap across the four issuers.</p>
              <div className="flex flex-wrap justify-between gap-2 pt-1 text-xs text-muted num">
                <span>Sources: GMGN · StonkFun rewards · stonk.fyi snapshots · StonkFun market data</span>
                <span>Change columns appear once readings cover 80% of the window</span>
              </div>
            </div>
          </>
        )}
      </Section>

      <p className="text-xs text-muted">
        Method on <Link href="/about#holders" className="underline underline-offset-2 hover:text-primary">the About page</Link>. Not financial advice.
      </p>
    </div>
  );
}
