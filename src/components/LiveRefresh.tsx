"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Re-renders the current server component tree on an interval so the page
// always shows fresh API data without a full reload.
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
      className="flex items-center gap-2 text-xs text-muted hover:text-primary"
      title={`Page refreshes every ${Math.round(intervalMs / 1000)}s; each figure shows its own upstream cache window next to its source. Click to refresh now.`}
    >
      <span className="live-dot" />
      <span className="num">updated {secs}s ago</span>
    </button>
  );
}
