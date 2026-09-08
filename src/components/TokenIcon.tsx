"use client";

import { useState } from "react";

// Token image with a same-origin cached proxy and an initials fallback. Icons are hosted on
// third-party gateways that go down (gateway.irys.xyz took ~80% of icons with it on 2026-09-08);
// a blank circle tells the reader nothing, initials at least identify the row.
export default function TokenIcon({ src, symbol, size = 24, className = "" }: { src?: string; symbol: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = symbol.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  const proxied = src ? `/api/icon?u=${encodeURIComponent(src)}` : undefined;
  const dim = { width: size, height: size };
  if (!proxied || failed) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-surface-2 text-muted font-medium select-none shrink-0 ${className}`}
        style={{ ...dim, fontSize: Math.round(size * 0.38) }}
        aria-hidden
      >
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={proxied} alt="" className={`rounded-full bg-surface-2 object-cover shrink-0 ${className}`} style={dim} loading="lazy" onError={() => setFailed(true)} />
  );
}
