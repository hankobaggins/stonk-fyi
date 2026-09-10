"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import LiveRefresh from "./LiveRefresh";
import BurnRing from "./BurnRing";
import BuyButton from "./BuyButton";
import { STONK_MINT_PUBLIC } from "@/lib/jtx";

const links = [
  { href: "/", label: "$STONK" },
  { href: "/platform", label: "Platform" },
  { href: "/tokens", label: "Tokens" },
  { href: "/pairs", label: "Pairs" },
  { href: "/flywheel", label: "Flywheel" },
  { href: "/launches", label: "Launches" },
  { href: "/rewards", label: "Rewards" },
  { href: "/yield", label: "Yield" },
  { href: "/holders", label: "Holders" },
  { href: "/about", label: "About" },
];

export default function Nav({ burnedPct }: { burnedPct: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the route changes (state adjusted during render, not in an effect).
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    setPrevPath(path);
    setOpen(false);
  }

  // Escape closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/88 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-13 flex items-center gap-5">
        <Link href="/" className="font-semibold tracking-tight flex items-center gap-2.5 shrink-0">
          <BurnRing pct={burnedPct} size={18} />
          stonk.fyi
          <span className="label border border-border-strong rounded px-1.5 py-1 text-[10px] leading-none font-medium">unofficial</span>
        </Link>

        {/* Desktop links (lg and up). */}
        <nav className="hidden lg:flex items-center gap-0.5 text-[13px] min-w-0 flex-1">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`px-2.5 py-1.5 rounded-md whitespace-nowrap shrink-0 ${active ? "bg-surface-2 text-primary" : "text-secondary hover:text-primary"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto shrink-0 flex items-center gap-2">
          <LiveRefresh intervalMs={60_000} />
          <span className="hidden sm:block"><BuyButton mint={STONK_MINT_PUBLIC} size="sm" /></span>
          {/* Menu button (tablet and smaller). */}
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden flex items-center justify-center w-9 h-9 -mr-1.5 rounded-md border border-border text-secondary hover:text-primary hover:bg-surface-2"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              {open ? (
                <>
                  <path d="M3 3l10 10" />
                  <path d="M13 3L3 13" />
                </>
              ) : (
                <>
                  <path d="M2 4h12" />
                  <path d="M2 8h12" />
                  <path d="M2 12h12" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu: a panel under the bar plus a backdrop that closes it on tap. */}
      {open && (
        <div className="lg:hidden">
          <div className="fixed inset-0 top-13 z-10 bg-bg/60" onClick={() => setOpen(false)} aria-hidden="true" />
          <nav
            id="mobile-nav"
            className="absolute left-0 right-0 top-full z-20 border-b border-border bg-bg shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 grid gap-0.5 text-[15px]">
              <div className="sm:hidden mb-1.5 grid"><BuyButton mint={STONK_MINT_PUBLIC} size="md" /></div>
              {links.map((l) => {
                const active = isActive(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`px-3 py-2.5 rounded-md ${active ? "bg-surface-2 text-primary" : "text-secondary hover:text-primary hover:bg-surface-1"}`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
