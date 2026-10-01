import Link from "next/link";
import { getTopTokens } from "@/lib/api";
import { fmtNum, fmtUsd, nowMs } from "@/lib/format";
import { PageHeader, Section } from "@/components/ui";
import { HBarChart, ShareBar } from "@/components/charts";
import { getQuoteBoard, type QuoteAssetRow } from "@/lib/quote-assets";
import { darkAfterClose, ORACLE_LABEL, usMarketOpen, type OracleState } from "@/lib/quote-math";
import IssuerGroupTable from "@/components/IssuerGroupTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pairs" };

type Agg = { key: string; label: string; category?: string; tokens: number; volume: number; mcap: number; graduated: number; topSymbol?: string; topMint?: string; topMcap: number };

export default async function PairsPage() {
  // Aggregate the top 300 tokens by volume — this captures effectively all active volume.
  const tokens = await getTopTokens(300, "volume");
  // Quote assets as markets (§6m): Jupiter + Pyth's feed list. Best-effort — the aggregate tables stand without it.
  const board = await getQuoteBoard(tokens).catch(() => null);
  const boardRow = new Map<string, QuoteAssetRow>((board?.rows ?? []).map((r) => [r.mint, r]));
  const open = usMarketOpen(nowMs());

  const byQuote = new Map<string, Agg>();
  const byCategory = new Map<string, Agg>();
  const bump = (map: Map<string, Agg>, key: string, label: string, t: (typeof tokens)[number], category?: string) => {
    const a = map.get(key) ?? { key, label, category, tokens: 0, volume: 0, mcap: 0, graduated: 0, topMcap: 0 };
    a.tokens++;
    a.volume += t.market?.volume24hUsd ?? 0;
    a.mcap += t.market?.marketCapUsd ?? 0;
    if (t.status === "graduated") a.graduated++;
    if ((t.market?.marketCapUsd ?? 0) > a.topMcap) {
      a.topMcap = t.market?.marketCapUsd ?? 0;
      a.topSymbol = t.symbol;
      a.topMint = t.mint;
    }
    map.set(key, a);
  };
  for (const t of tokens) {
    bump(byQuote, t.quote.mint, t.quote.symbol, t, t.quote.categoryLabel ?? t.quote.category);
    bump(byCategory, t.quote.category ?? "other", t.quote.categoryLabel ?? t.quote.category ?? "Other", t);
  }
  const quotes = [...byQuote.values()].sort((a, b) => b.volume - a.volume);
  const cats = [...byCategory.values()].sort((a, b) => b.volume - a.volume);
  const totalVol = tokens.reduce((s, t) => s + (t.market?.volume24hUsd ?? 0), 0);

  const maxShare = quotes[0]?.volume ?? 0;
  const top8 = quotes.slice(0, 8);
  const otherVol = quotes.slice(8).reduce((s, q) => s + q.volume, 0);
  const shareData = [...top8.map((q) => ({ name: q.label, value: q.volume })), ...(otherVol > 0 ? [{ name: "Other", value: otherVol }] : [])];

  return (
    <div className="space-y-5">
      <PageHeader title="Pairs" sub={<>What StonkFun tokens are priced against · top {tokens.length} tokens by volume · <span className="num">{fmtUsd(totalVol)} 24h volume</span></>} />

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="24h volume share by quote asset" action={<span className="num text-[11px] text-muted">StonkFun market data · 30s</span>}>
          <ShareBar data={shareData} />
        </Section>
        <Section title="24h volume by pair category" action={<span className="num text-[11px] text-muted">fixed category order</span>}>
          <HBarChart data={cats.map((c) => ({ name: c.label, value: c.volume }))} valueLabel="24h volume" />
        </Section>
      </div>

      <Section title="Quote assets" action={<span className="num text-[11px] text-muted">click a quote for its page · 30s</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Quote</th>
                <th>Category</th>
                <th className="r">Tokens</th>
                <th className="r">Graduated</th>
                <th className="r">24h volume</th>
                <th className="r">Share</th>
                <th className="r">Market cap</th>
                <th>Largest token</th>
                <th title="Does Pyth publish a price for the underlying after the US close?">Oracle</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.key}>
                  <td>
                    <Link href={`/pairs/${q.key}`} className="font-medium hover:text-accent">
                      {q.label}
                    </Link>
                  </td>
                  <td className="text-secondary">{q.category ?? "—"}</td>
                  <td className="r num">{q.tokens}</td>
                  <td className="r num">{q.graduated}</td>
                  <td className="r num">{fmtUsd(q.volume)}</td>
                  <td className="r num">
                    <span className="inline-flex items-center gap-2 justify-end">
                      <span className="aprbar w-[60px] !h-1.5 shrink-0"><i style={{ width: `${maxShare ? (q.volume / maxShare) * 100 : 0}%`, background: "var(--series-1)" }} /></span>
                      <span className="min-w-[44px] text-right">{totalVol ? `${((q.volume / totalVol) * 100).toFixed(1)}%` : "—"}</span>
                    </span>
                  </td>
                  <td className="r num">{fmtUsd(q.mcap)}</td>
                  <td>
                    {q.topMint ? <Link href={`/tokens/${q.topMint}`} className="hover:text-accent">{q.topSymbol}</Link> : q.topSymbol} <span className="text-muted num text-[11px]">{fmtUsd(q.topMcap)}</span>
                  </td>
                  <td><OraclePill state={boardRow.get(q.key)?.oracle?.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="num text-xs text-muted mt-3">{fmtNum(quotes.length)} distinct quote assets among the top {tokens.length} tokens. Categories follow the issuer, not the chain. Oracle is shown for tokenized stocks only.</p>
      </Section>

      {board?.gap && board.gap.equities > 0 && <OracleGap board={board} open={open} />}

      {board && board.groups.length > 0 && (
        <Section title="The same company, two prices" id="two-prices" action={<span className="src">Jupiter prices · 5 min</span>}>
          <p className="text-[13px] text-secondary mb-3 max-w-[80ch]">
            StonkFun lists {board.groups.length === 1 ? "one company" : `${board.groups.length} companies`} from more than one issuer. Where a public share price exists, a wide gap gets arbitraged; for a private company nobody publishes one, so no one — the issuers included — can say which figure is right. Part of a gap may be denomination (one issuer&apos;s token can represent a different slice of a share), and that is the problem: a buyer cannot check.
          </p>
          <div className="space-y-4">
            {board.groups.map((g) => (
              <div key={g.key}>
                <div className="flex items-baseline gap-3 mb-2">
                  <h3 className="text-[13px] font-semibold">{g.key}</h3>
                  {g.spreadPct != null && <span className={`state ${g.spreadPct < 2 ? "bull" : g.spreadPct < 10 ? "neutral" : "bear"}`}>{g.spreadPct.toFixed(1)}% apart</span>}
                  <span className="text-xs text-muted">{g.anyPublicFeed ? "public: a share price exists" : "private: no published share price"}</span>
                </div>
                <IssuerGroupTable group={g} />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

const ORACLE_STATE_CLASS: Record<OracleState, string> = { "247": "bull", proxy: "neutral", hours: "bear", none: "bear", crypto: "info" };

function OraclePill({ state }: { state?: OracleState }) {
  if (!state) return <span className="text-muted">—</span>;
  return <span className={`state ${ORACLE_STATE_CLASS[state]}`}>{ORACLE_LABEL[state]}</span>;
}

// Which stock quote assets have nothing independent pricing them after 16:00 ET (Pyth publishes a session-only feed,
// or none). Counted over the assets StonkFun coins actually use, weighted by those coins' volume.
function OracleGap({ board, open }: { board: NonNullable<Awaited<ReturnType<typeof getQuoteBoard>>>; open: boolean }) {
  const g = board.gap!;
  const eq = board.used.filter((r) => r.oracle && r.oracle.state !== "crypto");
  const share = g.equityVolume > 0 ? (g.darkVolume / g.equityVolume) * 100 : null;
  return (
    <Section title="The oracle gap" id="oracle-gap" action={<span className="src">Pyth feed list · 6 h · {open ? "US market open" : "US market closed"}</span>}>
      <p className="text-[13px] text-secondary mb-3 max-w-[80ch]">
        <span className="text-primary num">{g.dark}</span> of the <span className="num">{g.equities}</span> tokenized stocks StonkFun coins are priced in have no price after the closing bell
        {share != null && <> — <span className="text-primary num">{share.toFixed(0)}%</span> of those coins&apos; 24h volume</>}. Pyth publishes a session feed that stops at 16:00 ET and, for some names, an always-on one. A coin quoted in a stock without the always-on feed trades around the clock against a price nothing independent checks overnight and at weekends{open ? "" : " — which is now"}.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {eq.map((r) => (
          <Link key={r.mint} href={`/pairs/${r.mint}`} title={`${r.ticker}: ${r.oracle ? ORACLE_LABEL[r.oracle.state] : "?"}${r.oracle?.feed ? ` (${r.oracle.feed})` : ""} · ${r.coins} coins, ${fmtUsd(r.coinVolume)} 24h`}
            className={`state ${r.oracle && darkAfterClose(r.oracle.state) ? "bear" : r.oracle?.state === "proxy" ? "neutral" : "bull"} hover:opacity-80`}>
            {r.jupSymbol ?? r.symbol}
          </Link>
        ))}
      </div>
      <p className="num text-[11px] text-muted mt-3">
        Green: always-on Pyth feed. Grey: only an index that moves with it is always-on (S&amp;P 500 for SPY, Nasdaq-100 for QQQ). Amber: session-only feed or none. Stock assets used by the {board.sample} most-traded StonkFun coins. <Link href="/about#quote-assets" className="text-secondary hover:text-primary">Method →</Link>
      </p>
    </Section>
  );
}
