// Information architecture (redesign 2026-09-13, Rationale §1): four top-level items — the token, the platform it
// depends on, everything else, and the method. Grouped pages get a section strip under the ticker listing their
// siblings, so the second level is always visible without a hover. Shared by Nav (client) and SectionStrip.
export type NavChild = { href: string; label: string; hint: string };
export type NavGroup = { label: string; href?: string; menu?: NavChild[] };

export const NAV: NavGroup[] = [
  { label: "$STONK", href: "/" },
  {
    label: "Platform",
    menu: [
      { href: "/platform", label: "Overview", hint: "revenue · fees" },
      { href: "/flywheel", label: "Flywheel", hint: "buybacks · burns" },
    ],
  },
  {
    label: "Ecosystem",
    menu: [
      { href: "/tokens", label: "Tokens & yield", hint: "market · APR" },
      { href: "/pairs", label: "Pairs", hint: "quote assets" },
      { href: "/launches", label: "Launches", hint: "the ledger" },
      { href: "/rewards", label: "Rewards", hint: "holder payouts" },
      { href: "/holders", label: "Holders", hint: "every quote asset" },
    ],
  },
  { label: "About", href: "/about" },
];

export function childActive(href: string, path: string): boolean {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function groupOf(path: string): NavGroup | undefined {
  return NAV.find((g) => (g.href ? childActive(g.href, path) : g.menu?.some((m) => childActive(m.href, path))));
}
