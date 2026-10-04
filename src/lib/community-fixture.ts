import "server-only";
import fx from "@/fixtures/community.json";
import { inferDecimals, splitRaw, toTokens, type CommunityQuoteRow } from "./community-math";
import type { CommunityCoin, CommunityOverview, CommunityTraction } from "./community";
import type { RewardLaunch, Token } from "./types";

// DATA_SOURCE=fixture: Community Mode from real StonkFun responses captured 2026-10-04 (src/fixtures/community.json:
// community coins, their /rewards ledger rows, Jupiter quote prices, launches per day). Every coin is treated as
// launched in the mode (true for all of them at capture), so its whole payout is split. The per-day payout series is
// SYNTHETIC (no snapshots offline): the lifetime figure spread over the days by launch counts.
type Fx = { capturedAt: string; tokens: Token[]; launches: RewardLaunch[]; prices: Record<string, number>; launchDays: Record<string, { launches: number; community: number }> };
const data = fx as unknown as Fx;

function coins(): CommunityCoin[] {
  const led = new Map(data.launches.map((l) => [l.mint, l]));
  return data.tokens.map((t) => {
    const l = led.get(t.mint);
    const bps = t.communityMode?.shareBps ?? 3300;
    const dec = l ? l.quote.decimals ?? inferDecimals(l.distributedRaw, l.distributedTokens) ?? 0 : 0;
    const s = l?.distributedRaw ? splitRaw(BigInt(l.distributedRaw), [{ shareBps: bps, startRaw: BigInt(0), endRaw: null }]) : null;
    const p = data.prices[t.quote.mint];
    const toQ = s ? toTokens(s.toQuoteRaw, dec) : 0;
    const toC = s ? toTokens(s.toCoinRaw, dec) : 0;
    return {
      mint: t.mint, symbol: t.symbol, name: t.name, imageUrl: t.imageUrl ?? null, quoteMint: t.quote.mint, quoteSymbol: t.quote.symbol, createdAt: t.createdAt, status: t.status,
      marketCapUsd: t.market?.marketCapUsd ?? null, shareBps: bps, firstKind: "launch", communityTokens: toQ + toC, toQuoteTokens: toQ, toCoinTokens: toC,
      toQuoteUsd: p !== undefined ? toQ * p : null, toCoinUsd: p !== undefined ? toC * p : null, payoutCount: l?.payoutCount ?? 0, holderCount: l?.holderCount ?? 0, lastPayoutAt: l?.lastPayoutAt ?? null, switchedAt: null,
    } satisfies CommunityCoin;
  });
}

export async function fixtureCoins(limit: number, quoteMint: string | null): Promise<CommunityCoin[]> {
  return coins().filter((c) => !quoteMint || c.quoteMint === quoteMint).sort((a, b) => (b.toQuoteUsd ?? -1) - (a.toQuoteUsd ?? -1)).slice(0, limit);
}

export async function fixtureOverview(): Promise<CommunityOverview> {
  const cs = coins();
  const by = new Map<string, CommunityQuoteRow>();
  for (const c of cs) {
    const r = by.get(c.quoteMint) ?? { quoteMint: c.quoteMint, quoteSymbol: c.quoteSymbol ?? "?", coins: 0, active: 0, graduated: 0, toQuoteTokens: 0, toCoinTokens: 0, toQuoteUsd: data.prices[c.quoteMint] !== undefined ? 0 : null, toCoinUsd: data.prices[c.quoteMint] !== undefined ? 0 : null, payouts: 0, lastPayoutAt: null, firstAt: null };
    r.coins++;
    r.active += c.shareBps ? 1 : 0;
    r.graduated += c.status === "graduated" ? 1 : 0;
    r.toQuoteTokens += c.toQuoteTokens;
    r.toCoinTokens += c.toCoinTokens;
    if (r.toQuoteUsd !== null) r.toQuoteUsd += c.toQuoteUsd ?? 0;
    if (r.toCoinUsd !== null) r.toCoinUsd += c.toCoinUsd ?? 0;
    r.payouts += c.payoutCount ?? 0;
    if (c.lastPayoutAt && (!r.lastPayoutAt || c.lastPayoutAt > r.lastPayoutAt)) r.lastPayoutAt = c.lastPayoutAt;
    if (c.createdAt && (!r.firstAt || c.createdAt < r.firstAt)) r.firstAt = c.createdAt;
    by.set(c.quoteMint, r);
  }
  const byQuote = [...by.values()].sort((a, b) => (b.toQuoteUsd ?? -1) - (a.toQuoteUsd ?? -1));
  const sum = (f: (r: CommunityQuoteRow) => number) => byQuote.reduce((s, r) => s + f(r), 0);
  return {
    status: "ok", byQuote, coins: cs.length, active: cs.length, graduated: sum((r) => r.graduated), switched: 0,
    toQuoteUsd: sum((r) => r.toQuoteUsd ?? 0), toCoinUsd: sum((r) => r.toCoinUsd ?? 0), payouts: sum((r) => r.payouts),
    firstAt: byQuote.map((r) => r.firstAt).filter((x): x is string => !!x).sort()[0] ?? null, totalsAt: data.capturedAt, pricedAt: data.capturedAt, synthetic: true,
  };
}

export async function fixtureTraction(): Promise<CommunityTraction> {
  const days = Object.entries(data.launchDays).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, d]) => ({ date, launches: d.launches, community: d.community }));
  const total = (await fixtureOverview()).toQuoteUsd;
  const cm = days.reduce((s, d) => s + d.community, 0) || 1;
  return { days, paidPerDay: days.map((d) => ({ date: d.date, value: (total * d.community) / cm })) };
}
