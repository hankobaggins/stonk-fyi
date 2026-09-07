import type { Indicator, Signal } from "@/lib/stonk";

const SIGNAL: Record<Signal, { label: string; cls: string; dot: string }> = {
  bull: { label: "Bullish", cls: "text-up border-up/40", dot: "bg-up" },
  neutral: { label: "Neutral", cls: "text-secondary border-border-strong", dot: "bg-muted" },
  bear: { label: "Caution", cls: "text-down border-down/40", dot: "bg-down" },
  info: { label: "Context", cls: "text-muted border-border", dot: "bg-border-strong" },
};

const GROUPS: { key: Indicator["group"]; title: string; blurb: string }[] = [
  { key: "supply", title: "Supply", blurb: "Fixed supply, no mint authority, continuous burns." },
  { key: "flywheel", title: "Flywheel", blurb: "Platform fees → automated STONK buybacks → burns." },
  { key: "demand", title: "Demand", blurb: "Trading activity and STONK used as a base asset." },
  { key: "platform", title: "Platform", blurb: "The launchpad that generates the fees." },
  { key: "valuation", title: "Valuation", blurb: "Where the price sits relative to what the protocol earns." },
];

export function SignalPill({ signal }: { signal: Signal }) {
  const s = SIGNAL[signal];
  return (
    <span className={`pill ${s.cls}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export default function Scorecard({ indicators }: { indicators: Indicator[] }) {
  const bull = indicators.filter((i) => i.signal === "bull").length;
  const scored = indicators.filter((i) => i.signal !== "info").length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Bull-case scorecard</h2>
        <span className="text-sm text-secondary num">
          <span className="text-up font-medium">{bull}</span> of {scored} scored indicators bullish right now
        </span>
        <span className="text-xs text-muted">Each indicator is computed live and colored by its actual state — it can and will turn.</span>
      </div>
      {GROUPS.map((g) => {
        const items = indicators.filter((i) => i.group === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key} className="card p-4">
            <div className="flex items-baseline gap-3 mb-3">
              <h3 className="text-sm font-medium">{g.title}</h3>
              <span className="text-xs text-muted">{g.blurb}</span>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map((i) => (
                <div key={i.key} className="rounded-lg border border-border bg-surface-2/40 p-3 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted">{i.label}</div>
                    <SignalPill signal={i.signal} />
                  </div>
                  <div className="mt-1 text-xl font-semibold num">{i.value}</div>
                  <div className="mt-1 text-xs text-secondary leading-relaxed">{i.detail}</div>
                  {i.source && <div className="mt-1 text-[10px] font-mono text-muted">{i.source}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
