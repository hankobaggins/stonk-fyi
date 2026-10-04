"use client";

import { useRef, useState } from "react";

// A share card image with Save Image / Copy Image under it. Used by the wallet rewards check (§6o) and the Community Mode
// cards on /rewards (§6p).
// Two buttons under each card, Blockworks' share-image pattern (owner's call 2026-10-01): Save Image downloads the PNG,
// Copy Image puts it on the clipboard to paste into a post. The PNG is prefetched when the card renders, so the copy is
// instant and stays inside the click's user activation.
type CopyState = "idle" | "copied" | "failed";
export default function ShareCard({ src, name, alt, square = false, squareSize }: { src: string; name: string; alt: string; square?: boolean; squareSize?: number }) {
  const [copied, setCopied] = useState<CopyState>("idle");
  const blob = useRef<Blob | null>(null);
  // Prefetch the PNG for Copy once the image has loaded (a cache hit, not a second render), so the clipboard write is
  // instant and stays inside the click's user activation. Gallery cards load lazily, so nothing renders off-screen.
  const prefetch = () => {
    fetch(src)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) blob.current = b;
      })
      .catch(() => {});
  };
  const copy = async () => {
    let ok = false;
    try {
      // A ready Blob when prefetched; the promise form otherwise keeps Safari's user-gesture window open.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob.current ?? fetch(src).then((r) => r.blob()) })]);
      ok = true;
    } catch {
      ok = false;
    }
    setCopied(ok ? "copied" : "failed");
    setTimeout(() => setCopied("idle"), ok ? 2000 : 3500);
  };
  return (
    <figure className="flex flex-col gap-3 min-w-0">
      <CardImage key={src} src={src} alt={alt} square={square} squareSize={squareSize} onLoaded={prefetch} />
      <div className="grid grid-cols-2 gap-3">
        <a href={src} download={name} className="inline-flex items-center justify-center gap-2 h-11 rounded-md border border-border-strong text-[14px] font-medium text-primary hover:bg-surface-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>
          Save Image
        </a>
        <button type="button" onClick={copy} className="btn-check inline-flex items-center justify-center gap-2 h-11 rounded-md text-[14px] font-medium" aria-live="polite">
          {copied === "copied" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
          )}
          {copied === "copied" ? "Copied" : copied === "failed" ? "Can't copy here: use Save" : "Copy Image"}
        </button>
      </div>
    </figure>
  );
}

// Keyed by src, so a new version starts from the skeleton again.
function CardImage({ src, alt, square, squareSize, onLoaded }: { src: string; alt: string; square: boolean; squareSize?: number; onLoaded: () => void }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  return (
    <div className="relative rounded-md overflow-hidden border border-border bg-surface-2" style={{ aspectRatio: square ? "1 / 1" : "16 / 9" }}>
      {state === "loading" && <div className="skeleton absolute inset-0" />}
      {state === "failed" && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">Couldn&apos;t draw this card. Check again in a minute.</div>}
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated PNG the reader copies and downloads as-is */}
      <img
        src={src}
        alt={alt}
        width={square ? (squareSize ?? 1080) : 1600}
        height={square ? (squareSize ?? 1080) : 900}
        loading={square ? "lazy" : "eager"}
        onLoad={() => {
          setState("ok");
          onLoaded();
        }}
        onError={() => setState("failed")}
        className="w-full h-full object-cover"
      />
    </div>
  );
}

