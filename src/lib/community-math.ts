// Community Mode (StonkFun, live 2026-10-02): a reward coin whose holder payouts are split — `shareBps` of every payout
// (3300 = 33%) goes to holders of the coin's QUOTE token, the rest to the coin's own holders. StonkFun's API reports one
// distributed total per coin with both legs in it (checked on-chain 2026-10-03: payouts listed under a community coin
// went partly to wallets holding none of it), so the split is computed from the rule, over the time the coin spent in
// the mode. Coins can switch into the mode after launch (owner, 2026-10-03), and presumably out, so the mode is a series
// of periods, re-read by the worker (lib/community.ts). Pure: no I/O, checked by scripts/community-check.ts.

// The day the mode went live. A community coin created on or after this that this site never saw as a plain launch is
// treated as launched in the mode (its whole payout history is split); one created before it switched.
export const COMMUNITY_MODE_LIVE = "2026-10-02T00:00:00.000Z";
export const BPS = 10_000;

export type ModePeriod = { shareBps: number; startRaw: bigint; endRaw: bigint | null };
export type Split = { communityRaw: bigint; toQuoteRaw: bigint; toCoinRaw: bigint; plainRaw: bigint };

// Split a coin's lifetime distributed total (quote base units) over its periods. A period counts what was distributed
// between its start and its end (or now); the quote holders' share is floor(Δ × bps / 10000) per period. Amounts are
// clamped, so a total that went backwards (a stale upstream read) never gives a negative leg.
export function splitRaw(distributedRaw: bigint, periods: ModePeriod[]): Split {
  let communityRaw = BigInt(0);
  let toQuoteRaw = BigInt(0);
  for (const p of periods) {
    const hi = p.endRaw === null || p.endRaw > distributedRaw ? distributedRaw : p.endRaw;
    const lo = p.startRaw > hi ? hi : p.startRaw;
    const d = hi - lo;
    communityRaw += d;
    toQuoteRaw += (d * BigInt(p.shareBps)) / BigInt(BPS);
  }
  if (communityRaw > distributedRaw) communityRaw = distributedRaw;
  return { communityRaw, toQuoteRaw, toCoinRaw: communityRaw - toQuoteRaw, plainRaw: distributedRaw - communityRaw };
}

export const toTokens = (raw: bigint, decimals: number): number => {
  const base = BigInt(10) ** BigInt(Math.max(0, decimals));
  return Number(raw / base) + Number(raw % base) / Number(base);
};

// Decimals from a raw/whole pair when the ledger omits them (StonkFun gives both distributedRaw and distributedTokens).
export function inferDecimals(raw: string | undefined, tokens: number): number | null {
  if (!raw || !(tokens > 0)) return null;
  const r = Number(raw);
  if (!(r > 0)) return null;
  const d = Math.round(Math.log10(r / tokens));
  return d >= 0 && d <= 18 ? d : null;
}

// What one observation of a coin's mode means for its periods.
//   seen:       the coin's communityMode now (null = plain reward coin)
//   open:       its open period, if any
//   launchedAs: its mode in this site's launch record (reward_launches), null when the site never recorded the launch
//   hadPeriod:  it has a closed period (it was in the mode before)
export type Transition =
  | { kind: "open"; startKind: "launch" | "switch"; shareBps: number }
  | { kind: "close" }
  | { kind: "rate"; shareBps: number }
  | null;

export function transitionFor(
  seen: { shareBps: number } | null | undefined,
  open: { shareBps: number } | null,
  ctx: { createdAt: string; launchedAs: "community" | "plain" | null; hadPeriod: boolean },
): Transition {
  const bps = seen && seen.shareBps > 0 ? seen.shareBps : null;
  if (bps !== null && !open) {
    const launch = !ctx.hadPeriod && (ctx.launchedAs === "community" || (ctx.launchedAs === null && ctx.createdAt >= COMMUNITY_MODE_LIVE));
    return { kind: "open", startKind: launch ? "launch" : "switch", shareBps: bps };
  }
  if (bps === null && open) return { kind: "close" };
  if (bps !== null && open && bps !== open.shareBps) return { kind: "rate", shareBps: bps };
  return null;
}

// ---- Aggregation for the page ----

export type CommunityQuoteRow = {
  quoteMint: string;
  quoteSymbol: string;
  coins: number;
  active: number;
  graduated: number;
  toQuoteTokens: number;
  toCoinTokens: number;
  toQuoteUsd: number | null;   // at today's price
  toCoinUsd: number | null;
  payouts: number;
  lastPayoutAt: string | null;
  firstAt: string | null;
};

// Per-day quote-holder share in USD from cumulative per-quote readings (end of each UTC day, today partial), at today's
// prices. The first day of a quote asset's readings has no previous value: it counts from 0 only when its readings start
// on the mode's first day (they then cover the whole history), else it is skipped.
export function dailySeries(
  rows: { day: string; quoteMint: string; toQuoteTokens: number }[],
  prices: Record<string, number>,
  firstDay: string,
): { date: string; value: number }[] {
  const byQuote = new Map<string, { day: string; v: number }[]>();
  for (const r of rows) {
    const a = byQuote.get(r.quoteMint) ?? [];
    a.push({ day: r.day, v: r.toQuoteTokens });
    byQuote.set(r.quoteMint, a);
  }
  const out = new Map<string, number>();
  for (const [q, a] of byQuote) {
    const p = prices[q];
    if (p === undefined) continue;
    a.sort((x, y) => (x.day < y.day ? -1 : 1));
    let prev: number | null = a[0].day <= firstDay ? 0 : null;
    for (const r of a) {
      if (prev !== null) out.set(r.day, (out.get(r.day) ?? 0) + Math.max(0, r.v - prev) * p);
      prev = r.v;
    }
  }
  return [...out.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

export const sharePct = (bps: number): string => `${+(bps / 100).toFixed(2)}%`;
