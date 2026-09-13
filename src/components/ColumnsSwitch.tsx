"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readPref, subscribePrefs, writePref } from "@/lib/prefs";

const KEY = "stonk.fyi:columns";

// Columns: Essential / Full (redesign 2026-09-13, Rationale §5). Every wide table's priority-3 columns carry `.p3`;
// this switch sets `data-cols` on <html> and globals.css hides them. With no choice made, Essential is the default
// below md and Full above it (a media query), so the server render is right without knowing the preference.
export default function ColumnsSwitch() {
  const mode = useSyncExternalStore(subscribePrefs, () => readPref(KEY), () => null);
  useEffect(() => {
    const el = document.documentElement;
    if (mode === "essential" || mode === "full") el.dataset.cols = mode;
    else delete el.dataset.cols;
    return () => { delete el.dataset.cols; };
  }, [mode]);
  return (
    <span className="ml-auto flex items-center gap-1">
      <span className="label text-[10px] mr-1.5">Columns</span>
      <button type="button" onClick={() => writePref(KEY, "essential")} aria-current={mode === "essential" ? "true" : undefined}>Essential</button>
      <button type="button" onClick={() => writePref(KEY, "full")} aria-current={mode === "full" ? "true" : undefined}>Full</button>
    </span>
  );
}
