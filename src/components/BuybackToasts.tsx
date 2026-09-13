"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fmtNum, fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import { getMutedServer, isMuted, setMuted, subscribeMuted } from "@/lib/alerts";
import type { ProtocolEvent } from "@/app/api/buybacks/route";

type Toast = { id: string; events: ProtocolEvent[]; batches: number; at: number; replay?: boolean; explain: boolean };

const POLL_MS = 20_000;
const TTL_MS = 9_000;
const MAX_VISIBLE = 2;
const REPLAY_WINDOW_MS = 5 * 60_000;
const EXPLAIN_EVERY_MS = 5 * 60_000;

// Buybacks arrive as a batch (one buy per fee token in the same second, one shared burn tx),
// so events are grouped by burn signature, falling back to a 5s window by time.
function groupBatches(events: ProtocolEvent[]): ProtocolEvent[][] {
  const groups: ProtocolEvent[][] = [];
  for (const e of events) {
    const g = groups.find((x) => x[0].kind === e.kind && ((e.burnSignature && x[0].burnSignature === e.burnSignature) || Math.abs(Date.parse(x[0].at) - Date.parse(e.at)) < 5_000));
    if (g) g.push(e); else groups.push([e]);
  }
  return groups;
}

// Shows a toast when the protocol buys back or burns STONK. Polls /api/buybacks, seeds the seen-set on first
// load (replaying only the newest batch if it is under five minutes old), then announces new events. Toasts
// coalesce (redesign 2026-09-13, Rationale §7): everything within one poll becomes one toast of the same kind —
// summed value, "+N more in this sweep" — the explanatory sentence renders on the first toast in five minutes
// only, and the stack holds two.
export default function BuybackToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const muted = useSyncExternalStore(subscribeMuted, isMuted, getMutedServer);
  const seen = useRef<Set<string> | null>(null);
  const paused = useRef(false);
  const lastExplain = useRef(0);

  useEffect(() => {
    let alive = true;
    const explainNow = () => {
      const now = Date.now();
      if (now - lastExplain.current < EXPLAIN_EVERY_MS) return false;
      lastExplain.current = now;
      return true;
    };
    // Same-kind batches from one poll fold into one toast; the first batch's txs are the links.
    const coalesce = (batches: ProtocolEvent[][], replay = false): Toast[] =>
      (["buyback", "burn"] as const)
        .map((kind) => batches.filter((b) => b[0].kind === kind))
        .filter((bs) => bs.length)
        .map((bs) => ({ id: bs[0][0].id, events: bs.flat(), batches: bs.length, at: Date.now(), replay, explain: explainNow() }));
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/buybacks", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { events: ProtocolEvent[] };
        if (!alive) return;
        if (!seen.current) {
          seen.current = new Set(body.events.map((e) => e.id));
          const latest = groupBatches(body.events)[0];
          if (latest && Date.now() - Date.parse(latest[0].at) < REPLAY_WINDOW_MS && !isMuted()) {
            setToasts(coalesce([latest], true));
          }
          return;
        }
        const fresh = body.events.filter((e) => !seen.current!.has(e.id));
        for (const e of fresh) seen.current.add(e.id);
        if (fresh.length && !isMuted()) {
          const next = coalesce(groupBatches(fresh));
          setToasts((prev) => [...next, ...prev].slice(0, MAX_VISIBLE));
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
        const first = t.events[0];
        const isBuyback = first.kind === "buyback";
        const usd = t.events.reduce((a, e) => a + e.spentValueUsd, 0);
        const stonk = t.events.reduce((a, e) => a + e.stonk, 0);
        const burned = t.events.some((e) => e.burnSignature);
        const symbols = [...new Set(t.events.map((e) => e.symbol))];
        const title = isBuyback
          ? `${n === 1 ? "Protocol buyback" : `${n} protocol buybacks`}${burned ? " · burned" : ""}`
          : `${t.batches === 1 ? "Protocol burn" : `${t.batches} protocol burns`} · ${first.source}`;
        return (
          <div key={t.id} className="toast">
            <div className="flex items-baseline justify-between gap-3">
              <div className="label">{title}{t.replay ? <span className="text-muted"> · {timeAgo(first.at)}</span> : null}</div>
              <div className="flex gap-2.5 num">
                <button type="button" onClick={() => { setMuted(true); setToasts([]); }} className="text-[11px] text-muted hover:text-primary">mute</button>
                <button type="button" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="text-[13px] text-muted hover:text-primary leading-none" aria-label="Dismiss">×</button>
              </div>
            </div>
            <div className="num text-lg font-medium tracking-tight mt-1.5 mb-1 leading-tight">
              {fmtNum(stonk)} STONK {isBuyback ? "for" : "burned ·"} {fmtUsd(usd)}
            </div>
            {t.explain && (
              <div className="text-xs text-secondary leading-snug">
                {isBuyback
                  ? n === 1
                    ? <>Spent {fmtNum(first.spentTokens, 4)} {first.symbol} from platform fees.</>
                    : <>Fees in {symbols.slice(0, 3).join(", ")}{symbols.length > 3 ? ` and ${symbols.length - 3} more` : ""} swept into STONK.</>
                  : first.source === "quote-revenue"
                    ? <>Fee revenue collected in STONK from STONK-quoted pools, burned directly.</>
                    : <>STONK burned by the protocol&apos;s {first.source} program.</>}
              </div>
            )}
            <div className="flex items-center gap-3 mt-2 num text-[11px]">
              {isBuyback && <a href={`https://solscan.io/tx/${first.id}`} target="_blank" rel="noreferrer" className="text-muted hover:text-accent">buy {shortAddr(first.id, 4)} ↗</a>}
              {first.burnSignature && <a href={`https://solscan.io/tx/${first.burnSignature}`} target="_blank" rel="noreferrer" className="text-muted hover:text-accent">burn {shortAddr(first.burnSignature, 4)} ↗</a>}
              {t.batches > 1 && <span className="ml-auto text-muted">+{t.batches - 1} more in this sweep</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
