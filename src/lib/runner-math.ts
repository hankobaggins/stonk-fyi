// Pure math for the runners rail (§6k): which market-cap lines a token has crossed, how a window of
// crossings is counted, and how tokens are grouped into peak bands. No I/O, so scripts/runners-check.ts
// can exercise it offline.

export const RUNNER_LINES = [1e6, 5e6, 10e6, 25e6, 50e6, 100e6] as const;
export const RUNNER_FLOOR = RUNNER_LINES[0];

export type RunnerRow = {
  mint: string;
  thresholdUsd: number;
  symbol: string | null;
  name: string | null;
  quoteSymbol: string | null;
  createdAt: string | null;
  reachedAt: string | null; // null for seeded rows
  afterTs: string | null; // the crossing lies in (afterTs, reachedAt]; null = first time this site saw the token
  mode: string | null;
  peakUsd: number;
  marketCapUsd: number | null;
  status: "seeded" | "crossed" | string;
};

// The lifetime peak StonkFun reports, or the live market cap when it is higher (their peak can lag a tick).
export function peakOf(m?: { marketCapUsd?: number; peakMarketCapUsd?: number } | null): number {
  return Math.max(m?.peakMarketCapUsd ?? 0, m?.marketCapUsd ?? 0);
}

// Every line at or below a peak.
export function linesCrossed(peak: number): number[] {
  return RUNNER_LINES.filter((l) => peak >= l);
}

export function lineLabel(usd: number): string {
  return usd >= 1e9 ? `$${usd / 1e9}B` : `$${usd / 1e6}M`;
}

export type Band = { min: number; max: number | null; label: string; count: number };
export type WindowCounts = {
  hours: number;
  from: string;
  crossed: { line: number; count: number }[]; // tokens that crossed the line inside the window (cumulative: $1M+ includes $5M+)
  bands: Band[]; // tokens that crossed $1M inside the window, by the highest line they have reached so far
  top: RunnerRow[]; // the window's runners, one per token, by peak
};

// Count a window of crossings. `rows` = every crossed row with reachedAt inside the window; `highest` = the
// highest line each of those tokens has reached at any time (from every row for the mint, seeded included).
export function countWindow(rows: RunnerRow[], highest: Map<string, number>, hours: number, now: number): WindowCounts {
  const from = new Date(now - hours * 3.6e6).toISOString();
  const inWindow = rows.filter((r) => r.status === "crossed" && r.reachedAt && r.reachedAt >= from && Date.parse(r.reachedAt) <= now);
  const crossed = RUNNER_LINES.map((line) => ({ line, count: inWindow.filter((r) => r.thresholdUsd === line).length }));
  const entrants = inWindow.filter((r) => r.thresholdUsd === RUNNER_FLOOR);
  const bands: Band[] = RUNNER_LINES.map((min, i) => {
    const max = RUNNER_LINES[i + 1] ?? null;
    const count = entrants.filter((r) => {
      const h = highest.get(r.mint) ?? r.thresholdUsd;
      return h >= min && (max === null || h < max);
    }).length;
    return { min, max, label: max === null ? `${lineLabel(min)}+` : `${lineLabel(min)}–${lineLabel(max)}`, count };
  });
  const byMint = new Map<string, RunnerRow>();
  for (const r of inWindow) {
    const cur = byMint.get(r.mint);
    if (!cur || r.peakUsd > cur.peakUsd || (r.peakUsd === cur.peakUsd && r.thresholdUsd > cur.thresholdUsd)) byMint.set(r.mint, r);
  }
  const top = [...byMint.values()].sort((a, b) => b.peakUsd - a.peakUsd);
  return { hours, from, crossed, bands, top };
}

// Launch cohort: tokens launched inside the window, by their lifetime peak so far (the framing of the
// competitor tables this page answers — a token launched an hour ago has had an hour to run).
export type CohortToken = { mint: string; symbol: string | null; name: string | null; quoteSymbol: string | null; createdAt: string; peakUsd: number; lastSeenAt: string | null };
export function countCohort(tokens: CohortToken[]): { line: number; count: number }[] {
  return RUNNER_LINES.map((line) => ({ line, count: tokens.filter((t) => t.peakUsd >= line).length }));
}

// A crossing seen in a walk that never snapshotted the token before, for a token older than a day, is
// history this site had not indexed (e.g. the first full walk after the rail went live), not a runner.
export const SEED_AGE_H = 36;
export function crossingStatus(afterTs: string | null, createdAt: string | null, now: number): "seeded" | "crossed" {
  if (afterTs) return "crossed";
  if (!createdAt) return "seeded";
  return now - Date.parse(createdAt) > SEED_AGE_H * 3.6e6 ? "seeded" : "crossed";
}

// Ledger rows collapsed to one per token per reading: a token seen crossing several lines in one tick
// (a launch that opens above $5M crosses $1M and $5M at once) is one entry showing the highest line.
export type LedgerEntry = RunnerRow & { lines: number[] };
export function collapseLedger(rows: RunnerRow[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const idx = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.mint}@${r.reachedAt}`;
    const i = idx.get(k);
    if (i === undefined) {
      idx.set(k, out.length);
      out.push({ ...r, lines: [r.thresholdUsd] });
    } else {
      const e = out[i];
      e.lines.push(r.thresholdUsd);
      if (r.thresholdUsd > e.thresholdUsd) e.thresholdUsd = r.thresholdUsd;
    }
  }
  for (const e of out) e.lines.sort((a, b) => a - b);
  return out;
}
