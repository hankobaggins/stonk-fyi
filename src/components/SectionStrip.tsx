"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { childActive, groupOf } from "@/lib/nav";

// 38px strip under the ticker on grouped pages (Platform, Ecosystem): the group label and its sibling pages
// as chips, so the second nav level never depends on a hover. Absent on / and /about.
export default function SectionStrip() {
  const path = usePathname();
  const g = groupOf(path);
  if (!g?.menu) return null;
  return (
    <div className="border-b border-border">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 strip" aria-label={`${g.label} pages`}>
        <span className="label mr-2.5 shrink-0">{g.label}</span>
        {g.menu.map((m) => (
          <Link key={m.href} href={m.href} aria-current={childActive(m.href, path) ? "page" : undefined}>
            {m.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
