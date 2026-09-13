"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// The refresh pill: a bordered button with the live dot and "updated Ns ago" (just "Ns" on phones). Re-renders
// the server component tree on an interval so the page always shows fresh API data without a full reload.
export default function LiveRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const lastRef = useRef<number | null>(null);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    lastRef.current = Date.now();
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
        lastRef.current = Date.now();
      }
    }, intervalMs);
    const clock = setInterval(() => setSecs(Math.max(0, Math.floor((Date.now() - (lastRef.current ?? Date.now())) / 1000))), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [router, intervalMs]);

  return (
    <button
      type="button"
      onClick={() => {
        router.refresh();
        lastRef.current = Date.now();
        setSecs(0);
      }}
      className="inline-flex items-center gap-2 min-h-8 px-2.5 rounded-md border border-border text-secondary hover:text-primary"
      title={`Refreshes every ${Math.round(intervalMs / 1000)}s · click to refresh now. Each figure shows its own upstream cache window next to its source.`}
    >
      <span className="live-dot" />
      <span className="num text-xs"><span className="hidden sm:inline">updated </span>{secs}s<span className="hidden sm:inline"> ago</span></span>
    </button>
  );
}
