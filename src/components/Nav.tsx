"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LiveRefresh from "./LiveRefresh";
import BurnRing from "./BurnRing";

const links = [
  { href: "/", label: "$STONK" },
  { href: "/platform", label: "Platform" },
  { href: "/tokens", label: "Tokens" },
  { href: "/pairs", label: "Pairs" },
  { href: "/flywheel", label: "Flywheel" },
  { href: "/launches", label: "Launches" },
  { href: "/about", label: "About" },
];

export default function Nav({ burnedPct }: { burnedPct: number }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/88 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-13 flex items-center gap-5">
        <Link href="/" className="font-semibold tracking-tight flex items-center gap-2.5 shrink-0">
          <BurnRing pct={burnedPct} size={18} />
          stonk.fyi
          <span className="label border border-border-strong rounded px-1.5 py-1 text-[10px] leading-none font-medium">unofficial</span>
        </Link>
        <nav className="flex items-center gap-0.5 text-[13px] overflow-x-auto min-w-0 flex-1 [scrollbar-width:none]">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
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
        <div className="ml-auto shrink-0">
          <LiveRefresh intervalMs={60_000} />
        </div>
      </div>
    </header>
  );
}
