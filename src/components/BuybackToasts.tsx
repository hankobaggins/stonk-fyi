"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";
import { getMutedServer, isMuted, setMuted, subscribeMuted } from "@/lib/alerts";

type Feed = { signature: string; burnSignature: string | null; symbol: string; spentTokens: number; spentValueUsd: number; boughtTokens: number; boughtAt: string };
type Toast = { id: string; events: Feed[]; at: number };

const POLL_MS = 20_000;
const TTL_MS = 9_000;
const MAX_VISIBLE = 3;

// Shows a toast each time the protocol buys and burns STONK. Polls /api/buybacks, seeds the
// seen-set on first load (no replay of history), then announces only new signatures. Several
// buybacks landing in one poll collapse into one toast so a burst never floods the screen.
export default function BuybackToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const muted = useSyncExternalStore(subscribeMuted, isMuted, getMutedServer);
  const seen = useRef<Set<string> | null>(null);
  const paused = useRef(false);

  useEffect(() => {
    let alive = true;
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/buybacks", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { buybacks: Feed[] };
        if (!alive) return;
        if (!seen.current) {
          seen.current = new Set(body.buybacks.map((b) => b.signature));
          return;
        }
        const fresh = body.buybacks.filter((b) => !seen.current!.has(b.signature));
        for (const b of fresh) seen.current.add(b.signature);
        if (fresh.length && !isMuted()) {
          const t: Toast = { id: fresh[0].signature, events: fresh.sort((a, b) => Date.parse(b.boughtAt) - Date.parse(a.boughtAt)), at: Date.now() };
          setToasts((prev) => [t, ...prev].slice(0, MAX_VISIBLE));
        }
      } catch {
        /* network blip; next poll retries */
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  // Expire toasts; hovering the stack pauses the clock.
  useEffect(() => {
    if (!toasts.length) return;
    const id = setInterval(() => {
      if (paused.current) return;
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.at < TTL_MS));
    }, 500);
    return () => clearInterval(id);
  }, [toasts.length]);

  if (muted || !toasts.length) return null;

  return (
    <div
      className="toasts"
      role="status"
      aria-live="polite"
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; setToasts((prev) => prev.map((t) => ({ ...t, at: Date.now() }))); }}
    >
      {toasts.map((t) => {
        const n = t.events.length;
        const usd = t.events.reduce((a, e) => a + e.spentValueUsd, 0);
        const stonk = t.events.reduce((a, e) => a + e.boughtTokens, 0);
        const first = t.events[0];
        const burned = t.events.some((e) => e.burnSignature);
        return (
          <div key={t.id} className="toast">
            <div className="flex items-start justify-between gap-3">
              <div className="label">{n === 1 ? "Protocol buyback" : `${n} protocol buybacks`}{burned ? " · burned" : ""}</div>
              <button type="button" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="text-muted hover:text-primary leading-none -mt-0.5" aria-label="Dismiss">×</button>
            </div>
            <div className="num text-lg font-medium mt-1.5 leading-tight">
              {fmtNum(stonk)} STONK <span className="text-secondary text-sm">for {fmtUsd(usd)}</span>
            </div>
            <div className="text-xs text-secondary mt-1">
              {n === 1
                ? <>Spent {fmtNum(first.spentTokens, 4)} {first.symbol} from platform fees.</>
                : <>Fees in {[...new Set(t.events.map((e) => e.symbol))].slice(0, 4).join(", ")}{new Set(t.events.map((e) => e.symbol)).size > 4 ? " and more" : ""} swept into STONK.</>}
            </div>
            <div className="flex items-center gap-3 mt-2 num text-[11px]">
              <a href={`https://solscan.io/tx/${first.signature}`} target="_blank" rel="noreferrer" className="src">buy {shortAddr(first.signature, 4)}</a>
              {first.burnSignature && <a href={`https://solscan.io/tx/${first.burnSignature}`} target="_blank" rel="noreferrer" className="src">burn {shortAddr(first.burnSignature, 4)}</a>}
              <button type="button" onClick={() => { setMuted(true); setToasts([]); }} className="ml-auto text-muted hover:text-primary">mute</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
