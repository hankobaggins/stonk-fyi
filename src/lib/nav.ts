// Information architecture (redesign 2026-09-13, Rationale §1): four top-level items — the token, the platform it
// depends on, everything else, and the method. Grouped pages get a section strip under the ticker listing their
// siblings, so the second level is always visible without a hover. Shared by Nav (client) and SectionStrip.
export type NavChild = { href: string; label: string };
export type NavGroup = { label: string; href?: string; menu?: NavChild[] };

export const NAV: NavGroup[] = [
  { label: "$STONK", href: "/" },
  {
    label: "Platform",
    menu: [
      { href: "/platform", label: "Overview" },
      { href: "/flywheel", label: "Flywheel" },
    ],
  },
  {
    label: "Ecosystem",
    menu: [
      { href: "/tokens", label: "Tokens & yield" },
      { href: "/pairs", label: "Pairs" },
      { href: "/launches", label: "Launches" },
      { href: "/rewards", label: "Rewards" },
      { href: "/holders", label: "Holders" },
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
