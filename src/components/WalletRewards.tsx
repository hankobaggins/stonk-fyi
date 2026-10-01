"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmtNum, fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import { shareText, type WalletView } from "@/lib/wallet-rewards-math";

// The wallet rewards check (§6o), client side: streams the scan from /api/rewards/{wallet}, counts the total up as
// pages arrive, then shows the two share cards (PNG from /rewards-card/{wallet}) with copy / download / post / share,
// and the receipt underneath — per asset, the latest payouts with their transactions, and the reward coins the wallet
// holds with when each last paid its holders (the "I didn't get rewards" answer).

type Ev = { type: "progress"; view: WalletView; pages: number; txs: number } | { type: "done"; view: WalletView; reason: string } | { type: "error"; message: string; view: WalletView | null };
type Phase = "idle" | "scanning" | "done" | "paused" | "error";

const usd = (n: number) => {
  const a = Math.abs(n);
  if (a >= 100_000) return fmtUsd(n);
  if (a >= 100) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
};
const amt = (n: number) => (n >= 1000 ? fmtNum(n) : n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toPrecision(3));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const dur = reduce ? 0 : 700;
    let raf = 0;
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const v = start + (target - start) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

export default function WalletRewards({ wallet, initial }: { wallet: string; initial: WalletView | null }) {
  const [view, setView] = useState<WalletView | null>(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState(initial?.txsScanned ?? 0);
  const [anon, setAnon] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const running = useRef(false);

  const scan = useCallback(async (force = false) => {
    if (running.current) return;
    running.current = true;
    setPhase("scanning");
    setError(null);
    let rounds = 0;
    try {
      // A scan that runs out of its per-request time budget ("time") continues from its cursor on the next request.
      for (;;) {
        rounds++;
        const res = await fetch(`/api/rewards/${wallet}${force && rounds === 1 ? "?force=1" : ""}`, { cache: "no-store" });
        if (!res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let last: Ev | null = null;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as Ev;
            last = ev;
            if (ev.view) setView(ev.view);
            if (ev.type === "progress") setTxs(ev.txs);
          }
        }
        if (!last) throw new Error(`HTTP ${res.status}`);
        if (last.type === "error") {
          setError(last.message);
          setPhase("error");
          break;
        }
        if (last.type === "done") {
          setReason(last.reason);
          setTxs(last.view.txsScanned);
          if (last.reason === "time" && rounds < 12) continue;
          setPhase(last.reason === "rationed" || last.reason === "time" ? "paused" : "done");
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    } finally {
      running.current = false;
    }
  }, [wallet]);

  useEffect(() => {
    const t = setTimeout(() => void scan(false), 0);
    return () => clearTimeout(t);
  }, [scan]);
  useEffect(() => {
    const t0 = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, []);

  const total = useCountUp(view?.totalUsd ?? 0);
  const scanning = phase === "scanning" || phase === "idle";
  const paid = (view?.payouts ?? 0) > 0;
  const finished = view?.complete ?? false;
  const v = view?.scannedAt ? Date.parse(view.scannedAt) : 0;
  const cardUrl = (kind: "total" | "breakdown") => `/rewards-card/${wallet}?kind=${kind}${anon ? "&anon=1" : ""}&v=${v}`;
  const text = view ? shareText(view, usd) : "";

  return (
    <div className="space-y-5">
      {/* The number */}
      <section className="card p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
          <span className="num text-accent">{shortAddr(wallet, 4)}</span>
          <span className="text-secondary">{paid ? "has been paid" : scanning ? "is being checked" : "has been paid"}</span>
          {scanning && <span className="inline-flex items-center gap-2 num text-xs text-muted"><span className="live-dot" />reading on-chain history · {fmtNum(txs)} transactions</span>}
        </div>
        <div className={`num font-medium tracking-tight leading-none mt-4 text-[56px] sm:text-[88px] ${paid || scanning ? "text-up" : "text-muted"}`} aria-live="polite">{usd(total)}</div>
        <div className="mt-3 text-lg font-semibold">
          in StonkFun holder rewards{scanning && paid ? " so far" : "."}
        </div>
        {view && paid && (view.last7dUsd ?? 0) > 0 && (
          <div className="mt-4 inline-flex flex-wrap items-center gap-x-2 rounded-full border border-up/60 px-3.5 py-1.5 num text-[13px] text-up">
            <span>▲ +{usd(view.last7dUsd ?? 0)} in the last 7 days</span>
            <span className="text-secondary">· ≈ {usd((view.last7dUsd ?? 0) / 7)}/day</span>
          </div>
        )}
        {view && paid && (
          <div className="kpis mt-6 !border-b-0 !pb-0">
            <Kpi label="Payouts" value={view.payouts.toLocaleString("en-US")} sub="on-chain transfers to this wallet" />
            <Kpi label="Last payout" value={view.lastAt && now ? timeAgo(view.lastAt, now) : "—"} sub={view.lastAt ? day(view.lastAt) : "none found"} />
            <Kpi label="First payout" value={day(view.firstAt)} sub={view.firstAt && now ? `${Math.max(1, Math.round((now - Date.parse(view.firstAt)) / 86_400_000))} days ago` : " "} />
            <Kpi label="Paid in" value={`${view.assets.length} ${view.assets.length === 1 ? "asset" : "assets"}`} sub={view.pricedShare < 1 ? `${Math.round(view.pricedShare * 100)}% of payouts priced` : "all priced · today's prices"} />
          </div>
        )}
        <StatusLine phase={phase} reason={reason} error={error} view={view} now={now} onRescan={() => void scan(true)} />
      </section>

      {/* The cards */}
      {paid && !scanning && reason !== "no-db" && (
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-[13px] font-semibold">Share it</h2>
            <label className="inline-flex items-center gap-2 text-xs text-secondary cursor-pointer select-none">
              <input type="checkbox" checked={!anon} onChange={(e) => setAnon(!e.target.checked)} className="accent-[var(--accent)]" />
              Show wallet address on the cards
            </label>
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <ShareCard src={cardUrl("total")} name={`stonk-rewards-${wallet.slice(0, 4)}-total.png`} alt="Total rewards card" text={text} />
            <ShareCard src={cardUrl("breakdown")} name={`stonk-rewards-${wallet.slice(0, 4)}-by-asset.png`} alt="Rewards by asset card" text={text} />
          </div>
          <p className="text-xs text-muted mt-3">Posts carry the card image and a line of text, no link{anon ? "; the address is hidden on the cards" : ""}. On a computer, Post on X opens the post with the text and copies the image: paste it in.</p>
        </section>
      )}

      {view && paid && <Receipt view={view} now={now} />}
      {view && !paid && finished && <EmptyState view={view} now={now} />}

      <p className="text-xs text-muted leading-relaxed max-w-[100ch]">
        Read from the Solana chain: every plain token transfer into this wallet from StonkFun&apos;s reward wallets (5KXDF6… until Sep 20, HuBMe… since). Amounts are exact; USD is today&apos;s price
        (Jupiter; STONK at StonkFun&apos;s price), not the price on the day it landed. The chain records the asset paid, not the coin that earned it, so &quot;from&quot; is
        inferred from the reward coins this wallet holds now. Unofficial; not financial advice.{" "}
        <Link href="/about#wallet-rewards" className="text-secondary hover:text-primary">Method →</Link>
      </p>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi min-w-0">
      <div className="label">{label}</div>
      <div className="mt-2 text-[22px] leading-tight font-medium num truncate tracking-tight">{value}</div>
      <div className="mt-1.5 text-xs text-secondary num truncate">{sub}</div>
    </div>
  );
}

function StatusLine({ phase, reason, error, view, now, onRescan }: { phase: Phase; reason: string | null; error: string | null; view: WalletView | null; now: number | null; onRescan: () => void }) {
  let msg: React.ReactNode = null;
  if (phase === "error") msg = <span className="text-down">Couldn&apos;t finish reading this wallet: {error}. What was read so far is shown and kept.</span>;
  else if (phase === "paused" && reason === "rationed") msg = <span className="text-caution">Paused: this site&apos;s hourly budget for on-chain reads is used up. It resumes where it stopped; try again in a few minutes.</span>;
  else if (phase === "paused") msg = <span className="text-caution">This wallet has a long history; the scan stopped part-way and resumes where it left off.</span>;
  else if (phase === "done" && view?.scannedAt && now) msg = <span>Checked {timeAgo(view.scannedAt, now)} · {fmtNum(view.txsScanned)} transactions read{reason === "elsewhere" ? " (by another visitor)" : ""}.</span>;
  if (!msg) return null;
  const canRetry = phase !== "scanning";
  return (
    <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-secondary">
      <div>{msg}</div>
      {canRetry && (
        <button type="button" onClick={onRescan} className="btn-ghost">
          {phase === "paused" || phase === "error" ? "Continue" : "Check again"}
        </button>
      )}
    </div>
  );
}

// Share row for one card. Posts never carry a link (owner's call 2026-10-01).
// - "Post / share…" (any device whose browser can share files — phones, and Safari/Chrome on macOS): the share sheet
//   hands the PNG and the text to X / Telegram / Messages. On phones this is the only share button.
// - "Post on X" (desktop only: a fine pointer that can hover): opens a new X post with the text only. X's web intent
//   cannot attach a file, so the PNG also goes to the clipboard and the note says to paste it (⌘V / Ctrl+V). The PNG is
//   fetched when the card renders so the clipboard write is instant and the tab opens inside the click's activation.
function ShareCard({ src, name, alt, text }: { src: string; name: string; alt: string; text: string }) {
  const [note, setNote] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const blob = useRef<Blob | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setDesktop(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false);
      try {
        setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] }));
      } catch {
        setCanShare(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    blob.current = null;
    let live = true;
    fetch(src)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (live && b) blob.current = b;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [src]);
  const flash = (t: string, tone: "ok" | "warn" = "ok", ms = 2600) => {
    setNote({ text: t, tone });
    setTimeout(() => setNote(null), ms);
  };
  const png = (): Blob | Promise<Blob> => blob.current ?? fetch(src).then((r) => r.blob());
  const copyImage = async (): Promise<boolean> => {
    try {
      // A ready Blob when prefetched; the promise form otherwise keeps Safari's user-gesture window open.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png() })]);
      return true;
    } catch {
      return false;
    }
  };
  const copy = async () => {
    flash((await copyImage()) ? "Image copied — paste it into your post" : "This browser can't copy images — use Download", "ok");
  };
  const shareSheet = async () => {
    try {
      const b = await png();
      await navigator.share({ files: [new File([b], name, { type: "image/png" })], text });
    } catch {
      // dismissed
    }
  };
  const postToX = async () => {
    const copied = await copyImage();
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    if (copied) flash("Image copied: press ⌘V / Ctrl+V in the X post to attach it", "ok", 9000);
    else flash("Couldn't copy the image in this browser: Download it and attach it to the post", "warn", 9000);
  };
  return (
    <figure className="flex flex-col gap-3 min-w-0">
      <CardImage key={src} src={src} alt={alt} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className="btn-check rounded-md h-9 px-3.5 text-[13px] font-medium">Copy image</button>
        <a href={src} download={name} className="btn-ghost h-9">Download</a>
        {desktop && <button type="button" onClick={postToX} className="btn-ghost h-9">Post on X</button>}
        {canShare && <button type="button" onClick={shareSheet} className="btn-ghost h-9">{desktop ? "Share…" : "Post / share…"}</button>}
        {!desktop && !canShare && <button type="button" onClick={postToX} className="btn-ghost h-9">Post on X</button>}
        {note && <span className={`num text-xs ${note.tone === "ok" ? "text-up" : "text-caution"}`}>{note.text}</span>}
      </div>
    </figure>
  );
}

// Keyed by src, so a new version starts from the skeleton again.
function CardImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative rounded-md overflow-hidden border border-border bg-surface-2" style={{ aspectRatio: "16 / 9" }}>
      {!loaded && <div className="skeleton absolute inset-0" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated PNG the reader copies and downloads as-is */}
      <img src={src} alt={alt} width={1600} height={900} onLoad={() => setLoaded(true)} className="w-full h-full object-cover" />
    </div>
  );
}

function Receipt({ view, now }: { view: WalletView; now: number | null }) {
  return (
    <div className="space-y-5">
      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 mb-3">
          <h2 className="text-[13px] font-semibold">By asset received</h2>
          <span className="num text-[11px] text-muted">on-chain amounts · USD at today&apos;s prices · Jupiter · 5 min</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Asset</th><th>From (inferred)</th><th className="r">Received</th><th className="r">USD now</th><th className="r">Payouts</th><th className="r">First</th><th className="r">Last</th></tr></thead>
            <tbody>
              {view.assets.map((a) => (
                <tr key={a.mint}>
                  <td className="font-medium" style={{ fontFamily: "var(--font-sans)" }}>{a.symbol}</td>
                  <td className="text-secondary">{a.from.length ? a.from.join(", ") : <span className="text-muted">no coin held now</span>}</td>
                  <td className="r num">{amt(a.amount)} {a.symbol}</td>
                  <td className="r num">{a.usd !== null ? usd(a.usd) : <span className="text-muted">unpriced</span>}</td>
                  <td className="r num">{fmtNum(a.payouts)}</td>
                  <td className="r num text-muted">{day(a.first)}</td>
                  <td className="r num text-muted">{now ? timeAgo(a.last, now) : day(a.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid lg:grid-cols-[3fr_2fr] gap-5">
        <section className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 mb-3">
            <h2 className="text-[13px] font-semibold">Latest payouts</h2>
            <span className="num text-[11px] text-muted">newest {view.recent.length} · each one a transaction you can open</span>
          </div>
          <div className="table-wrap max-h-[420px] overflow-y-auto">
            <table className="data">
              <thead><tr><th>When</th><th className="r">Amount</th><th className="r">Tx</th></tr></thead>
              <tbody>
                {view.recent.map((r) => (
                  <tr key={r.sig + r.mint}>
                    <td className="text-muted num">{now ? timeAgo(r.ts, now) : day(r.ts)}</td>
                    <td className="r num">{amt(r.amount)} {r.symbol}</td>
                    <td className="r"><a href={`https://solscan.io/tx/${r.sig}`} target="_blank" rel="noopener noreferrer" className="num text-xs text-secondary hover:text-accent">{shortAddr(r.sig, 4)} ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <CoinsTable view={view} now={now} />
      </div>
    </div>
  );
}

// Reward coins held now, each with when it last paid its holders (StonkFun's ledger) and when this wallet last
// received the asset it pays in (the chain). A coin that paid recently while this wallet got nothing in that asset
// is the one case worth a support ticket.
function CoinsTable({ view, now }: { view: WalletView; now: number | null }) {
  const lastIn = new Map(view.assets.map((a) => [a.mint, a.last]));
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 mb-3">
        <h2 className="text-[13px] font-semibold">Reward coins in this wallet</h2>
        <span className="num text-[11px] text-muted">held now · StonkFun rewards ledger</span>
      </div>
      {view.coins.length === 0 ? (
        <p className="text-xs text-secondary">No StonkFun reward coins in this wallet right now. Payouts above came from coins held earlier, or held in another wallet.</p>
      ) : (
        <div className="table-wrap max-h-[420px] overflow-y-auto">
          <table className="data">
            <thead><tr><th>Coin</th><th>Pays in</th><th className="r">Paid holders</th><th className="r">Paid you</th></tr></thead>
            <tbody>
              {view.coins.map((c) => {
                const you = lastIn.get(c.quote) ?? lastIn.get(c.mint) ?? null;
                return (
                  <tr key={c.mint}>
                    <td><Link href={`/tokens/${c.mint}`} className="hover:text-accent" style={{ fontFamily: "var(--font-sans)" }}>{c.symbol ?? shortAddr(c.mint, 4)}</Link></td>
                    <td className="text-secondary">{c.quoteSymbol ?? shortAddr(c.quote, 4)}</td>
                    <td className="r num text-muted">{c.lastPayoutAt && now ? timeAgo(c.lastPayoutAt, now) : "—"}</td>
                    <td className="r num">{you && now ? timeAgo(you, now) : <span className={c.lastPayoutAt && now && now - Date.parse(c.lastPayoutAt) < 86_400_000 ? "text-caution" : "text-muted"}>never</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EmptyState({ view, now }: { view: WalletView; now: number | null }) {
  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">No StonkFun reward payouts to this wallet</h2>
        <p className="text-[13px] text-secondary mt-1.5 max-w-[80ch]">
          {fmtNum(view.txsScanned)} transactions read, and none of them is a payout from StonkFun&apos;s reward wallets. Rewards are pushed to holders
          automatically; there is nothing to claim. The usual reasons a holder sees nothing:
        </p>
      </div>
      <ul className="text-[13px] text-secondary space-y-2 list-disc pl-5 max-w-[80ch]">
        <li><span className="text-primary">The coin is a standard launch.</span> Only reward-mode coins pay holders; standard coins pay their creator. A coin&apos;s page on this site shows its mode.</li>
        <li><span className="text-primary">It hasn&apos;t paid out since you bought.</span> A reward coin collects fees until the pot is worth sending, then pays everyone holding at that moment.</li>
        <li><span className="text-primary">The coins are in another wallet.</span> An exchange, a trading bot or a second wallet gets the payout, not this address.</li>
        <li><span className="text-primary">It paid in an asset you didn&apos;t look for.</span> Payouts arrive in the coin&apos;s quote asset (SPYx, SOL, GOLD…), or in the coin itself.</li>
      </ul>
      {view.coins.length > 0 && (
        <>
          {(() => {
            const recent = now ? view.coins.filter((c) => c.lastPayoutAt && now - Date.parse(c.lastPayoutAt) < 86_400_000) : [];
            return recent.length > 0 ? (
              <p className="text-[13px] text-caution max-w-[80ch]">
                {recent.map((c) => c.symbol ?? shortAddr(c.mint, 4)).join(", ")} paid {recent.length === 1 ? "its" : "their"} holders in the last 24 hours and nothing reached this
                wallet. If it held the coin at that moment, that is worth raising with StonkFun&apos;s mods: send them the link to this page.
              </p>
            ) : null;
          })()}
          <CoinsTable view={view} now={now} />
        </>
      )}
    </section>
  );
}
