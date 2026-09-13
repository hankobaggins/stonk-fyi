import type { Indicator, Signal } from "@/lib/stonk";

// Scorecard grammar shared by the tally, the cells and the OG card. Pure data, no React.

export type CellState = Signal | "collecting";
export const STATE_WORD: Record<CellState, string> = { bull: "bullish", neutral: "neutral", bear: "caution", info: "context", collecting: "collecting" };

export const GROUPS: { keys: Indicator["group"][]; title: string; blurb: string; expected: string[]; providers: Record<string, string> }[] = [
  { keys: ["flywheel"], title: "Flywheel", blurb: "Fees → buybacks → burns. Rises and falls with launchpad activity.", expected: ["burnrate", "buyback", "buybackvol", "revgrowth", "buybackprice"], providers: {} },
  { keys: ["demand"], title: "Demand", blurb: "Who is buying STONK, and how deep the market is.", expected: ["quoted", "pooldepth", "netflow", "turnover", "change24"], providers: {} },
  {
    keys: ["holders"],
    title: "Holders & flow",
    blurb: "Holder base via HolderScan; order flow and wallet tags via GMGN.",
    expected: ["holders", "holders1k", "diamond", "breakeven", "top10", "buypressure", "smartmoney"],
    providers: { holders: "HolderScan and GMGN", holders1k: "HolderScan", diamond: "HolderScan", breakeven: "HolderScan", top10: "GMGN", buypressure: "GMGN", smartmoney: "GMGN" },
  },
  { keys: ["platform", "valuation"], title: "Platform & valuation", blurb: "The fee source, and what the price pays for it.", expected: ["platform", "launchmult", "ps"], providers: {} },
];

// Labels for cells a down provider would have filled, so the group header, the summary and the tally can
// show the absence (dashed) instead of a gap.
const LABELS: Record<string, string> = {
  holders: "Holders", holders1k: "Holders over $1K", diamond: "Diamond hands, top 1000", breakeven: "Price vs holders' break-even",
  top10: "Top-10 concentration", buypressure: "Buy share, 24h, all pools", smartmoney: "Smart-money holders",
};

// The threshold behind each state, one line, for the cell popover. The reasoning lives on /about#scored.
export const RULES: Record<string, string> = {
  burnrate: "bullish above 0.3% / day",
  buyback: "bullish above $10K / day",
  buybackvol: "bullish above 1% of volume",
  revgrowth: "bullish above +20% vs prior 7d",
  buybackprice: "bullish above 1×",
  quoted: "bullish above $1M · neutral above $100K",
  pooldepth: "bullish above $5M · neutral above $500K",
  netflow: "bullish when net buying",
  turnover: "bullish between 2% and 100%",
  change24: "bullish above 0",
  holders: "bullish above +0.5% / 24h · neutral within ±0.5%",
  holders1k: "bullish above +0.5% / 24h · neutral within ±0.5%",
  diamond: "bullish at 50% or more · neutral at 25%",
  breakeven: "context only · not scored",
  top10: "bullish below 20% · neutral below 35%",
  buypressure: "bullish above 52% · neutral 48–52%",
  smartmoney: "bullish at 100 or more · neutral at 25",
  platform: "bullish above $10M · neutral above $1M",
  launchmult: "context only · not scored",
  ps: "bullish below 10×",
};

export type Cell = Indicator & { placeholder?: boolean };

// An indicator still accumulating data (net flow before 12h of snapshots) is "collecting", not context: it will
// be scored, it just isn't yet. A placeholder for a down provider reads the same way.
export function stateOf(i: Cell): CellState {
  if (i.placeholder) return "collecting";
  return i.signal === "info" && i.value === "collecting" ? "collecting" : i.signal;
}

export type GroupView = { title: string; blurb: string; cells: Cell[]; missing: Cell[]; providers: string[]; summary: string };

// Groups with their present cells, plus placeholders for expected cells a provider failed to deliver.
export function groupViews(indicators: Indicator[]): GroupView[] {
  return GROUPS.map((g) => {
    const cells: Cell[] = indicators.filter((i) => g.keys.includes(i.group));
    const present = new Set(cells.map((c) => c.key));
    const missing: Cell[] = g.expected
      .filter((k) => !present.has(k) && LABELS[k])
      .map((k) => ({ key: k, label: LABELS[k], value: "—", detail: "", signal: "info", group: g.keys[0], placeholder: true }));
    const providers = [...new Set(missing.map((m) => g.providers[m.key]).filter(Boolean))];
    const counts = new Map<string, number>();
    for (const c of cells) {
      const w = STATE_WORD[stateOf(c)];
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const parts = ["bullish", "neutral", "caution", "context", "collecting"].filter((k) => counts.has(k)).map((k) => `${counts.get(k)} ${k}`);
    if (missing.length) parts.push(`${missing.length} unscored`);
    return { title: g.title, blurb: g.blurb, cells, missing, providers, summary: parts.join(" · ") };
  }).filter((g) => g.cells.length || g.missing.length);
}

// The tally in scorecard order: present cells plus placeholders, so the bar keeps its length when a provider is down.
export function tallyCells(indicators: Indicator[]): Cell[] {
  return groupViews(indicators).flatMap((g) => [...g.cells, ...g.missing]);
}
