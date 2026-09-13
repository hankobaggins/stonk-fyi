import type { Indicator } from "@/lib/stonk";
import { stateOf, tallyCells } from "@/lib/scorecard";

// One segment per indicator, in scorecard order; unscored (context, collecting, provider down) is dashed. Segments
// are flex:1 so 13 → 20 → 30 indicators just get thinner; a state change fades over 400ms (globals.css).
export default function TallyBar({ indicators }: { indicators: Indicator[] }) {
  const cells = tallyCells(indicators);
  const bull = cells.filter((i) => stateOf(i) === "bull").length;
  const scored = cells.filter((i) => { const s = stateOf(i); return s !== "info" && s !== "collecting"; }).length;
  return (
    <div className="border-y border-border py-4 grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-3 md:gap-6 items-center">
      <div className="num text-[30px] leading-none font-medium tracking-tight">
        {bull}<span className="text-sm text-muted ml-1.5 font-normal">/ {scored} scored bullish</span>
      </div>
      <div className={`segs ${cells.length > 24 ? "!gap-[2px]" : ""}`} role="img" aria-label={`${bull} of ${scored} scored indicators bullish; ${cells.length - scored} unscored`}>
        {cells.map((i) => <i key={i.key} className={stateOf(i)} title={i.placeholder ? `${i.label}: provider down` : `${i.label}: ${i.value}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 num text-[11px] text-muted whitespace-nowrap">
        <span><i className="sw mr-1.5 bg-up" />bullish</span>
        <span><i className="sw mr-1.5 bg-neutral" />neutral</span>
        <span><i className="sw mr-1.5 bg-caution" />caution</span>
        <span><i className="sw mr-1.5 border border-dashed border-border-strong" />unscored</span>
      </div>
    </div>
  );
}
