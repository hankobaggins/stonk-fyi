"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import LiveRefresh from "./LiveRefresh";
import BurnRing from "./BurnRing";
import BuyButton from "./BuyButton";
import { STONK_MINT_PUBLIC } from "@/lib/jtx";
import { childActive, groupOf, NAV } from "@/lib/nav";

// Sticky 52px bar: mark + wordmark, four nav items (two with hover/focus dropdowns), the refresh pill, the one
// Buy button. Below lg the items move into a panel under the bar (groups as headings, children indented, 44px
// rows, Buy first below sm). Escape and the backdrop close everything.
export default function Nav({ burnedPct }: { burnedPct: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const active = groupOf(path)?.label;

  // Close the mobile panel and any dropdown whenever the route changes (state adjusted during render).
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    setPrevPath(path);
    setOpen(false);
    setMenu(null);
  }

  useEffect(() => {
    if (!open && !menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, menu]);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/88 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-13 flex items-center gap-4">
        <Link href="/" className="font-semibold tracking-tight flex items-center gap-2.5 shrink-0 text-[15px]">
          <BurnRing pct={burnedPct} size={18} />
          stonk.fyi
          <span className="label border border-border-strong rounded px-1.5 py-1 text-[10px] leading-none font-medium">unofficial</span>
        </Link>

        {/* Desktop: four items; dropdowns open on hover or focus-within. */}
        <nav className="hidden lg:flex items-center gap-0.5 text-[13px] min-w-0 flex-1" aria-label="Primary">
          {NAV.map((g) => {
            const on = g.label === active;
            const isOpen = menu === g.label;
            const href = g.href ?? g.menu![0].href;
            return (
              <div
                key={g.label}
                className="relative shrink-0"
                onMouseEnter={() => g.menu && setMenu(g.label)}
                onMouseLeave={() => setMenu(null)}
                onFocus={() => g.menu && setMenu(g.label)}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(null); }}
              >
                <Link
                  href={href}
                  aria-current={on ? "page" : undefined}
                  aria-haspopup={g.menu ? "menu" : undefined}
                  aria-expanded={g.menu ? isOpen : undefined}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md whitespace-nowrap ${on || isOpen ? "bg-surface-2 text-primary" : "text-secondary hover:text-primary"}`}
                >
                  {g.label}
                  {g.menu && <span className="num text-[9px] opacity-70" aria-hidden="true">▾</span>}
                </Link>
                {g.menu && isOpen && (
                  <div className="menu" role="menu">
                    {g.menu.map((m) => (
                      <Link key={m.href} href={m.href} role="menuitem" aria-current={childActive(m.href, path) ? "page" : undefined} onClick={() => setMenu(null)}>
                        <span>{m.label}</span>
                        <span className="num text-[11px] text-muted">{m.hint}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="ml-auto shrink-0 flex items-center gap-2.5">
          <LiveRefresh intervalMs={60_000} />
          <span className="hidden sm:block"><BuyButton mint={STONK_MINT_PUBLIC} size="sm" /></span>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden flex flex-col items-center justify-center gap-[5px] w-11 h-11 -mr-2 text-secondary hover:text-primary"
          >
            {open ? (
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 3l10 10" /><path d="M13 3L3 13" /></svg>
            ) : (
              <>
                <i className="block w-[18px] h-[1.5px] bg-current" />
                <i className="block w-[18px] h-[1.5px] bg-current" />
                <i className="block w-[18px] h-[1.5px] bg-current" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Panel under the bar: groups as headings with children indented; backdrop closes it on tap. */}
      {open && (
        <div className="lg:hidden">
          <div className="fixed inset-0 top-13 z-10 bg-bg/60" onClick={() => setOpen(false)} aria-hidden="true" />
          <nav id="mobile-nav" aria-label="Primary" className="absolute left-0 right-0 top-full z-20 border-b border-border-strong bg-surface-1 shadow-[var(--shadow-toast)]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-4 grid gap-1 text-[15px]">
              <div className="sm:hidden mb-2 grid"><BuyButton mint={STONK_MINT_PUBLIC} size="md" className="min-h-11" /></div>
              {NAV.map((g) => {
                const on = g.label === active;
                return (
                  <div key={g.label} className="grid gap-1">
                    <Link
                      href={g.href ?? g.menu![0].href}
                      aria-current={on && g.href ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex items-center justify-between min-h-11 px-2.5 rounded-md ${on ? "text-primary" : "text-secondary hover:text-primary"} ${on && g.href ? "bg-surface-2" : ""}`}
                    >
                      {g.label}
                      {g.menu && <span className="label">{g.menu.length} pages</span>}
                    </Link>
                    {g.menu?.map((m) => {
                      const cur = childActive(m.href, path);
                      return (
                        <Link key={m.href} href={m.href} aria-current={cur ? "page" : undefined} onClick={() => setOpen(false)} className={`flex items-center justify-between min-h-11 pl-[26px] pr-2.5 rounded-md ${cur ? "bg-surface-2 text-primary" : "text-secondary hover:text-primary hover:bg-surface-2/60"}`}>
                          <span>{m.label}</span>
                          <span className="num text-[11px] text-muted">{m.hint}</span>
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
