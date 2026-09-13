"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { readPref, subscribePrefs, writePref } from "@/lib/prefs";
import type { Indicator } from "@/lib/stonk";
import { type Cell as CellData, type CellState, groupViews, RULES, STATE_WORD, stateOf } from "@/lib/scorecard";

const EXPAND_KEY = "stonk.fyi:scorecard-details";

export function StatePill({ signal, text }: { signal: CellState; text?: string }) {
  return <span className={`state ${signal}`}>{text ?? STATE_WORD[signal]}</span>;
}

// Compact indicator cell (redesign 2026-09-13, Rationale §3, option a): the grid reads as value + state; the
// sentence is one hover, focus or tap away; the source line never leaves the cell. "Show all details" renders
// the sentence inline in every cell and disables the popover.
function Cell({ i, open, inline, onOpen, onClose }: { i: CellData; open: boolean; inline: boolean; onOpen: () => void; onClose: () => void }) {
  const s = stateOf(i);
  const rule = RULES[i.key];
  const showPop = open && !inline;
  return (
    <div
      className={`ind ${s} ${showPop ? "open" : ""}`}
      tabIndex={0}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onFocus={onOpen}
      onBlur={onClose}
      onPointerDown={(e) => { if (e.pointerType === "touch" && !(e.target as HTMLElement).closest("a")) { e.preventDefault(); if (open) onClose(); else onOpen(); } }}
      aria-describedby={showPop ? `pop-${i.key}` : undefined}
    >
      <div className="flex items-start justify-between gap-2 min-h-[22px]">
        <div className="label leading-[1.3]">{i.label}</div>
        <StatePill signal={s} />
      </div>
      <div className={`num text-[20px] md:text-2xl leading-[1.2] font-medium tracking-tight mt-2.5 mb-2 ${s === "collecting" ? "text-muted" : ""}`}>{s === "collecting" ? "—" : i.value}</div>
      {inline && i.detail && <div className="text-[12.5px] text-secondary leading-snug mb-2">{i.detail}</div>}
      {inline && rule && <div className="num text-[11px] text-muted mb-2">{rule}</div>}
      <div className="src mt-auto min-h-[14px]">{i.source ?? ""}</div>
      {showPop && (i.detail || rule) && (
        <div className="popover" role="tooltip" id={`pop-${i.key}`}>
          {i.detail && <div className="text-[12.5px] text-primary leading-[1.4]">{i.detail}</div>}
          <div className="flex justify-between gap-3 num text-[11px]">
            <span className="text-muted">{rule ?? ""}</span>
            <Link href="/about#scored" className="text-secondary hover:text-primary whitespace-nowrap" onClick={(e) => e.stopPropagation()}>method →</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Scorecard({ indicators, watch }: { indicators: Indicator[]; watch: { label: string; detail: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  // The toggle persists per browser (external store, so hydration never disagrees).
  const expandAll = useSyncExternalStore(subscribePrefs, () => readPref(EXPAND_KEY) === "1", () => false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const toggleAll = () => {
    setOpen(null);
    writePref(EXPAND_KEY, expandAll ? "0" : "1");
  };

  const groups = groupViews(indicators);
  const unscored = groups.reduce((a, g) => a + g.missing.length, 0);
  const downProviders = [...new Set(groups.flatMap((g) => g.providers))];

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h2 className="text-[15px] font-semibold tracking-tight">Scorecard</h2>
          <span className="text-[13px] text-muted">Hover a cell for the sentence behind the number. Sources stay visible.</span>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          aria-pressed={expandAll}
          className={`text-xs px-2.5 py-1.5 rounded-md border border-border hover:text-primary ${expandAll ? "bg-surface-2 text-primary" : "bg-surface-1 text-secondary"}`}
        >
          {expandAll ? "Hide details" : "Show all details"}
        </button>
      </div>

      {groups.map((g) => (
        <section key={g.title} className="pt-5">
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 mb-3">
            <h3 className="text-[15px] font-semibold tracking-tight">{g.title}</h3>
            <p className="text-[13px] text-muted">{g.blurb}</p>
            <span className="ml-auto num text-xs text-muted">{g.summary}</span>
          </div>
          {g.cells.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 items-stretch">
              {g.cells.map((i) => (
                <Cell key={i.key} i={i} open={open === i.key} inline={expandAll} onOpen={() => setOpen(i.key)} onClose={() => setOpen((o) => (o === i.key ? null : o))} />
              ))}
            </div>
          )}
          {g.missing.length > 0 && (
            <div className={`provider-down ${g.cells.length ? "mt-3" : ""}`}>
              <StatePill signal="collecting" text="provider down" />
              <span>
                {g.providers.join(" and ")} didn&apos;t answer on this read. {g.missing.length === 1 ? "One indicator is" : `${g.missing.length} indicators are`} unscored until {g.providers.length > 1 ? "they do" : "it does"}:{" "}
                <span className="text-muted">{g.missing.map((m) => m.label).join(" · ")}</span>.
              </span>
              <span className="ml-auto num text-[11px] text-muted">{g.providers.join(" · ")} · retry every 5 min</span>
            </div>
          )}
        </section>
      ))}

      <div className="watch mt-5 px-4 sm:px-[18px] py-3.5 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 items-start">
        <div className="label text-caution pt-0.5">What to watch</div>
        <ul className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-[13px] leading-[1.45] text-secondary">
          {watch.filter((w) => w.detail).map((w) => (
            <li key={w.label}><strong className="text-primary font-semibold">{w.label}.</strong> {w.detail}</li>
          ))}
          {unscored > 0 && (
            <li><strong className="text-primary font-semibold">{unscored === 1 ? "One indicator" : `${unscored} indicators`} unscored.</strong> {downProviders.join(" and ")} didn&apos;t answer on this read; the tally counts only what was verified.</li>
          )}
        </ul>
      </div>
    </section>
  );
}
