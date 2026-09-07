import type { StonkData } from "@/lib/stonk";
import { STONK_INITIAL_SUPPLY } from "@/lib/stonk";
import { fmtNum, fmtUsd, timeAgo } from "@/lib/format";
import BurnRing from "./BurnRing";

// The facts that can only move one way. They are not scored: a signal that cannot turn is not a
// signal, it is the floor the scorecard sits on. The burn ring is the site mark at full size.
export default function Foundation({ d, now }: { d: StonkData; now: number }) {
  const s = d.supply;
  const g = d.gmgn;
  const checks: { label: string; ok: boolean | null; note: string }[] = [
    { label: "Fixed supply", ok: true, note: `${fmtNum(STONK_INITIAL_SUPPLY)} minted once` },
    { label: "Mint authority renounced", ok: g ? g.security.mintRenounced : null, note: "no new supply, ever" },
    { label: "Freeze authority renounced", ok: g ? g.security.freezeRenounced : null, note: "no wallet can be frozen" },
    { label: "Liquidity burned", ok: g ? g.security.lpBurned : null, note: g?.security.lpBurnedPct ? `${g.security.lpBurnedPct.toFixed(0)}% of LP tokens burned` : "LP tokens burned" },
    { label: "No transfer tax", ok: g ? g.security.buyTax === 0 && g.security.sellTax === 0 : null, note: "0% buy, 0% sell" },
  ];
  return (
    <section className="border-y border-border py-6 grid grid-cols-1 md:grid-cols-[auto_1fr_1fr] gap-x-8 gap-y-5 items-center">
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <BurnRing pct={s.burnedPct} size={128} width={14} stroke="var(--surface-2)" track="var(--series-2)" label={`${s.burnedPct.toFixed(2)}% of supply burned`} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="num text-[22px] font-medium leading-none">{s.burnedPct.toFixed(2)}%</div>
            <div className="label mt-1.5">burned</div>
          </div>
        </div>
        <div>
          <div className="label mb-1.5">Structural · one-way</div>
          <div className="text-[15px] font-semibold tracking-tight">Supply can only fall</div>
          <p className="text-[12.5px] text-secondary mt-1 max-w-[30ch] leading-snug">{fmtNum(s.burned)} STONK destroyed and gone. This number never goes down, so it is not scored; it is the floor.</p>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs self-center">
        <dt className="text-muted">Initial supply</dt><dd className="num text-right">{fmtNum(STONK_INITIAL_SUPPLY)}</dd>
        <dt className="text-muted">Burned</dt><dd className="num text-right">{fmtNum(s.burned)} · {fmtUsd(d.burns?.totals.valueUsdAtBurn)} at burn</dd>
        <dt className="text-muted">Circulating</dt><dd className="num text-right">{fmtNum(s.circulating)}</dd>
        {s.impliedFromMarket && (<><dt className="text-muted">Implied, mcap ÷ price</dt><dd className="num text-right">{fmtNum(s.impliedFromMarket)}</dd></>)}
        <dt className="text-muted">Burn events</dt><dd className="num text-right">{fmtNum(d.burns?.totals.burnCount)} · last {timeAgo(d.burns?.totals.lastBurnAt, now)}</dd>
      </dl>

      <ul className="grid gap-1.5 text-xs self-center">
        {checks.map((c) => (
          <li key={c.label} className="flex items-baseline gap-2.5">
            <span className={`num shrink-0 ${c.ok === null ? "text-muted" : c.ok ? "text-up" : "text-caution"}`}>{c.ok === null ? "·" : c.ok ? "✓" : "✗"}</span>
            <span className="text-primary">{c.label}</span>
            <span className="text-muted num truncate">{c.ok === null ? "unverified (GMGN offline)" : c.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
