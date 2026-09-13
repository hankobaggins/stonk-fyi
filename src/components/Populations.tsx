import Link from "next/link";
import { fmtNum } from "@/lib/format";

// The three ways to count a holder (redesign 2026-09-13, Rationale §6): three bars on one scale, each with the
// swatch that then travels with every tile, chart and column carrying that population. Series slots are fixed —
// series-1 on-chain, series-7 HolderScan, series-2 StonkFun-paid — never status colours. They are never summed.
export const POP = {
  onchain: { name: "On-chain holders", color: "var(--series-1)" },
  holderscan: { name: "HolderScan holders", color: "var(--series-7)" },
  paid: { name: "StonkFun-paid wallets", color: "var(--series-2)" },
} as const;

export function Swatch({ p, lg = false }: { p: keyof typeof POP; lg?: boolean }) {
  return <i className={`sw ${lg ? "lg" : ""}`} style={{ background: POP[p].color }} aria-hidden="true" />;
}

type Pop = { key: keyof typeof POP; value: number | null; floor?: boolean; detail: string; src: string; def: string };

export default function Populations({ pops }: { pops: Pop[] }) {
  const max = Math.max(1, ...pops.map((p) => p.value ?? 0));
  return (
    <section className="border-b border-border pb-4 grid lg:grid-cols-[3fr_2fr] gap-x-8 gap-y-4 items-start">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 mb-3">
          <h2 className="text-[15px] font-semibold tracking-tight">Three ways to count a holder</h2>
          <span className="text-[13px] text-muted">Same wallets, three lenses. They are never added together.</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-4 gap-y-2.5 items-center">
          {pops.map((p) => (
            <div key={p.key} className="contents">
              <div className="flex items-center gap-2 whitespace-nowrap text-[13px] font-medium"><Swatch p={p.key} lg />{POP[p.key].name}</div>
              <div className="hidden md:block h-[22px] bg-surface-1 border border-border rounded overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 rounded-[3px] opacity-85" style={{ width: `${p.value ? Math.max(1.5, (p.value / max) * 100) : 0}%`, background: POP[p.key].color }} />
              </div>
              <span className="num text-xs text-primary whitespace-nowrap text-right">{p.value === null ? <span className="text-muted">no reading</span> : <>{p.floor ? "≥ " : ""}{fmtNum(p.value)} {p.detail}</>}</span>
              <span className="num text-[11px] text-muted whitespace-nowrap hidden md:inline">{p.src}</span>
              <p className="text-xs text-secondary leading-snug -mt-1 mb-1 col-span-2 md:col-start-2 md:col-span-3">{p.def} <span className="num text-muted md:hidden">{p.src}</span></p>
            </div>
          ))}
        </div>
      </div>
      <div className="text-[12.5px] text-secondary leading-relaxed flex flex-col gap-2.5 lg:pt-1">
        <p><strong className="text-primary font-semibold">The swatch travels with the number.</strong> Every holder figure on this page — tile, chart or table column — carries the swatch of the population it counts, so a reader never has to remember which is which.</p>
        <p>HolderScan covers only the assets it tracks, so its totals are lower bounds; on-chain counts are floors (<span className="num">≥</span>) because the census scans the largest accounts first; StonkFun-paid wallets are exact for the coins covered, at least for the rest.</p>
        <Link href="/about#holders" className="num text-[11px] text-secondary hover:text-primary">Full definitions →</Link>
      </div>
    </section>
  );
}
