import type { Indicator, Signal } from "@/lib/stonk";

const STATE: Record<Signal, string> = { bull: "bullish", neutral: "neutral", bear: "caution", info: "context" };

const GROUPS: { keys: Indicator["group"][]; title: string; blurb: string }[] = [
  { keys: ["flywheel"], title: "Flywheel", blurb: "Fees → buybacks → burns. Rises and falls with launchpad activity." },
  { keys: ["demand"], title: "Demand", blurb: "Who is buying STONK, and how deep the market is." },
  { keys: ["holders"], title: "Holders & flow", blurb: "Holder base via HolderScan; order flow and wallet tags via GMGN." },
  { keys: ["platform", "valuation"], title: "Platform & valuation", blurb: "The fee source, and what the price pays for it." },
];

// An indicator that is still accumulating data (net flow before 12h of snapshots) is shown as
// "collecting", not as context: it will be scored, it just isn't yet.
function stateOf(i: Indicator): Signal | "collecting" {
  return i.signal === "info" && i.value === "collecting" ? "collecting" : i.signal;
}

export function StatePill({ signal, text }: { signal: Signal | "collecting"; text?: string }) {
  return <span className={`state ${signal}`}>{text ?? (signal === "collecting" ? "collecting" : STATE[signal])}</span>;
}

// Per-group summary for the section header, e.g. "2 bullish · 1 neutral · 1 collecting".
function groupSummary(items: Indicator[]): string {
  const counts = new Map<string, number>();
  for (const i of items) {
    const s = stateOf(i);
    const k = s === "collecting" ? "collecting" : STATE[s];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return ["bullish", "neutral", "caution", "context", "collecting"].filter((k) => counts.has(k)).map((k) => `${counts.get(k)} ${k}`).join(" · ");
}

export function TallyBar({ indicators }: { indicators: Indicator[] }) {
  const bull = indicators.filter((i) => i.signal === "bull").length;
  const scored = indicators.filter((i) => i.signal !== "info").length;
  return (
    <div className="border-y border-border py-4 grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-4 md:gap-6 items-center">
      <div className="num text-[30px] leading-none font-medium tracking-tight">
        {bull}<span className="text-sm text-muted ml-1.5 font-normal">/ {scored} scored bullish</span>
      </div>
      <div className="segs" role="img" aria-label={`${bull} of ${scored} scored indicators bullish; ${indicators.length - scored} unscored`}>
        {indicators.map((i) => <i key={i.key} className={stateOf(i)} title={`${i.label}: ${i.value}`} />)}
      </div>
      <div className="flex gap-4 num text-[11px] text-muted whitespace-nowrap">
        <span><i className="inline-block w-2 h-2 rounded-[2px] mr-1.5 align-[-1px] bg-up" />bullish</span>
        <span><i className="inline-block w-2 h-2 rounded-[2px] mr-1.5 align-[-1px] bg-neutral" />neutral</span>
        <span><i className="inline-block w-2 h-2 rounded-[2px] mr-1.5 align-[-1px] bg-caution" />caution</span>
        <span><i className="inline-block w-2 h-2 rounded-[2px] mr-1.5 align-[-1px] border border-dashed border-border-strong" />unscored</span>
      </div>
    </div>
  );
}

function Cell({ i }: { i: Indicator }) {
  const s = stateOf(i);
  return (
    <div className={`ind ${s}`}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="label">{i.label}</div>
        <StatePill signal={s} />
      </div>
      <div className={`num text-2xl leading-tight font-medium tracking-tight mt-2.5 mb-1.5 ${s === "collecting" ? "text-muted" : ""}`}>{s === "collecting" ? "—" : i.value}</div>
      <div className="text-[12.5px] text-secondary leading-snug">{i.detail}</div>
      {i.source && <div className="mt-2 src">{i.source}</div>}
    </div>
  );
}

export default function Scorecard({ indicators, watch }: { indicators: Indicator[]; watch: { label: string; detail: string }[] }) {
  return (
    <div>
      {GROUPS.map((g) => {
        const items = indicators.filter((i) => g.keys.includes(i.group));
        if (!items.length) return null;
        const cols = items.length === 1 ? "md:grid-cols-2 xl:grid-cols-3" : items.length === 2 ? "md:grid-cols-2 xl:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3";
        return (
          <section key={g.title} className="pt-7 pb-1">
            <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 mb-3.5">
              <h3 className="text-[15px] font-semibold tracking-tight">{g.title}</h3>
              <p className="text-[13px] text-muted">{g.blurb}</p>
              <span className="ml-auto num text-xs text-muted">{groupSummary(items)}</span>
            </div>
            <div className={`grid ${cols} gap-3`}>
              {items.map((i) => <Cell key={i.key} i={i} />)}
            </div>
          </section>
        );
      })}

      <div className="watch mt-5 p-4 sm:px-5 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-5 gap-y-2">
        <div className="label text-caution pt-0.5">What to watch</div>
        <ul className="grid md:grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] text-secondary">
          {watch.filter((w) => w.detail).map((w) => (
            <li key={w.label} className="flex gap-2">
              <span className="text-caution shrink-0">–</span>
              <span><span className="text-primary font-medium">{w.label}.</span> {w.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
