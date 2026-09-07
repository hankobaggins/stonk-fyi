"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LiveRefresh from "./LiveRefresh";

const links = [
  { href: "/", label: "$STONK" },
  { href: "/platform", label: "Platform" },
  { href: "/tokens", label: "Tokens" },
  { href: "/pairs", label: "Pairs" },
  { href: "/flywheel", label: "Flywheel" },
  { href: "/launches", label: "Launches" },
  { href: "/about", label: "About" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
        <Link href="/" className="font-semibold tracking-tight flex items-center gap-2 shrink-0">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent" />
          stonk.fyi
        </Link>
        <nav className="flex items-center gap-1 text-sm overflow-x-auto min-w-0 flex-1 [scrollbar-width:none]">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-md whitespace-nowrap shrink-0 ${active ? "bg-surface-2 text-primary" : "text-secondary hover:text-primary"}`}
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
