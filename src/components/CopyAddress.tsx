"use client";

import { useState } from "react";

// Click-to-copy for a full address or URL, shown truncated. Used where a reader needs the exact mint (asset pages,
// coin rows) — the look-alike problem is a wrong address, not a wrong name.
export default function CopyAddress({ value, label, className = "" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context / permissions)
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      aria-label={`Copy ${label ?? value}`}
      className={`inline-flex items-center gap-1.5 num text-[11px] text-secondary hover:text-primary ${className}`}
    >
      <span>{label ?? `${value.slice(0, 4)}…${value.slice(-4)}`}</span>
      <span className="label border border-border-strong rounded px-1 py-0.5 text-[10px] leading-none">{copied ? "copied" : "copy"}</span>
    </button>
  );
}
