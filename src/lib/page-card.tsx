import type { ReactNode } from "react";
import { C, Ring } from "@/lib/card";
import { SITE_NAME } from "@/lib/site";
import { PAGE_SPECS, type PageKey } from "@/lib/page-meta";

// Link-preview cards for the static pages, served by /og/[page]; the page list, titles and copy live in
// lib/page-meta.ts. Title cards by design: no live figures, so a scraper's cached copy is never stale and the route
// costs no upstream reads. One frame (masthead, title + one-line description, page motif, footer path) with a
// schematic motif per page drawn in the ledger palette. Motifs carry no values: shapes only, plus labels that are
// fixed facts of the page (the runner lines, the graduation line, source lines). The home card (/og) stays live.

// Series palette (globals.css --series-1..8), assigned in fixed order, never reused for status.
const S = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const GRID = "#1c2d34";
const SURFACE2 = "#16262d";
const mono = { fontFamily: "Geist Mono" };

const MW = 440; // motif box
const MH = 330;

// Deterministic jitter so every render of a motif is identical (the card is static).
function seq(seed: number, n: number): number[] {
  let s = seed;
  return Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  });
}

function Box({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", position: "relative", width: MW, height: MH }}>{children}</div>;
}

function Abs({ x, y, children, style }: { x: number; y: number; children: ReactNode; style?: Record<string, string | number> }) {
  return <div style={{ position: "absolute", left: x, top: y, display: "flex", ...style }}>{children}</div>;
}

const Label = ({ children, color = C.ink3, size = 13 }: { children: ReactNode; color?: string; size?: number }) => (
  <div style={{ ...mono, fontSize: size, fontWeight: 500, letterSpacing: 1.4, color, display: "flex" }}>{children}</div>
);

const Pill = ({ children, color }: { children: ReactNode; color: string }) => (
  <div style={{ ...mono, fontSize: 13, fontWeight: 500, color, border: `1px solid ${color}`, borderRadius: 4, padding: "3px 7px", display: "flex" }}>{children}</div>
);

// ---- motifs ---------------------------------------------------------------

// Platform: daily fee revenue as bars over gridlines.
function PlatformMotif() {
  const r = seq(7, 30);
  const n = r.length;
  const bw = 10;
  const gap = (MW - n * bw) / (n - 1);
  const base = MH - 34;
  return (
    <Box>
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={MW} y1={base - f * 250} y2={base - f * 250} stroke={GRID} strokeWidth={1} />)}
        {r.map((v, i) => {
          const h = 40 + (0.35 + 0.65 * (i / n)) * 200 * (0.55 + 0.45 * v);
          return <rect key={i} x={i * (bw + gap)} y={base - h} width={bw} height={h} rx={2} fill={S[0]} />;
        })}
        <line x1={0} x2={MW} y1={base} y2={base} stroke={C.lineStrong} strokeWidth={1} />
      </svg>
      <Abs x={0} y={MH - 22}><Label>DAILY FEE REVENUE · USD · UTC DAYS</Label></Abs>
    </Box>
  );
}

// Flywheel: revenue → buyback → burn as a loop; the closing arc is dashed (burns shrink supply, they don't pay revenue).
function FlywheelMotif() {
  const cx = MW / 2;
  const cy = 150;
  const R = 112;
  const nodes = [
    { a: -90, label: "FEE REVENUE", color: S[0] },
    { a: 30, label: "BUYBACK", color: S[2] },
    { a: 150, label: "BURN", color: S[1] },
  ].map((n) => ({ ...n, x: cx + R * Math.cos((n.a * Math.PI) / 180), y: cy + R * Math.sin((n.a * Math.PI) / 180) }));
  const nodeR = 30;
  // Arc from angle a0 to a1 (clockwise), trimmed by the node radius, with an arrowhead at the end.
  const trim = (nodeR + 10) / R; // radians
  const arc = (a0: number, a1: number) => {
    const s = (a0 * Math.PI) / 180 + trim;
    const e = (a1 * Math.PI) / 180 - trim;
    const p = (t: number) => `${(cx + R * Math.cos(t)).toFixed(1)} ${(cy + R * Math.sin(t)).toFixed(1)}`;
    const head = (() => {
      const ex = cx + R * Math.cos(e);
      const ey = cy + R * Math.sin(e);
      const tx = -Math.sin(e); // tangent (clockwise)
      const ty = Math.cos(e);
      const nx = Math.cos(e);
      const ny = Math.sin(e);
      const L = 11;
      const W = 6;
      return `M ${(ex + tx * 2).toFixed(1)} ${(ey + ty * 2).toFixed(1)} L ${(ex - tx * L + nx * W).toFixed(1)} ${(ey - ty * L + ny * W).toFixed(1)} L ${(ex - tx * L - nx * W).toFixed(1)} ${(ey - ty * L - ny * W).toFixed(1)} Z`;
    })();
    return { d: `M ${p(s)} A ${R} ${R} 0 0 1 ${p(e)}`, head };
  };
  const a1 = arc(-90, 30);
  const a2 = arc(30, 150);
  const a3 = arc(150, 270);
  return (
    <Box>
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`}>
        <path d={a1.d} fill="none" stroke={C.ink3} strokeWidth={2} />
        <path d={a1.head} fill={C.ink3} />
        <path d={a2.d} fill="none" stroke={C.ink3} strokeWidth={2} />
        <path d={a2.head} fill={C.ink3} />
        <path d={a3.d} fill="none" stroke={C.lineStrong} strokeWidth={2} strokeDasharray="5 6" />
        <path d={a3.head} fill={C.lineStrong} />
        {/* revenue + buyback: filled discs */}
        {nodes.slice(0, 2).map((n) => (
          <g key={n.label}>
            <circle cx={n.x} cy={n.y} r={nodeR} fill={C.surface} stroke={n.color} strokeWidth={3} />
            <circle cx={n.x} cy={n.y} r={9} fill={n.color} />
          </g>
        ))}
        {/* burn: the ring with a bite, bite in the burn series colour */}
        <circle cx={nodes[2].x} cy={nodes[2].y} r={nodeR} fill={C.surface} />
        <circle cx={nodes[2].x} cy={nodes[2].y} r={nodeR - 7} fill="none" stroke={C.lineStrong} strokeWidth={10} />
        <circle cx={nodes[2].x} cy={nodes[2].y} r={nodeR - 7} fill="none" stroke={S[1]} strokeWidth={10} strokeDasharray={`${2 * Math.PI * (nodeR - 7) * 0.22} ${2 * Math.PI * (nodeR - 7)}`} transform={`rotate(-90 ${nodes[2].x} ${nodes[2].y})`} />
      </svg>
      <Abs x={nodes[0].x + nodeR + 14} y={nodes[0].y - 9}><Label color={C.ink2}>{nodes[0].label}</Label></Abs>
      <Abs x={nodes[1].x - 60} y={nodes[1].y + nodeR + 12}><Label color={C.ink2}>{nodes[1].label}</Label></Abs>
      <Abs x={nodes[2].x - 22} y={nodes[2].y + nodeR + 12}><Label color={C.ink2}>{nodes[2].label}</Label></Abs>
      <Abs x={0} y={MH - 22}><Label>EVERY STEP LINKS TO ITS TX ON SOLSCAN</Label></Abs>
    </Box>
  );
}

// Tokens & yield: the table, as a skeleton. Two rows are standard coins (APR "—"), the rest reward coins with 24h / 3d bars.
function TokensMotif() {
  const rows = [
    { name: 150, apr: [0.92, 0.7] },
    { name: 110, apr: null },
    { name: 170, apr: [0.48, 0.62] },
    { name: 120, apr: [0.3, 0.26] },
    { name: 140, apr: null },
    { name: 100, apr: [0.16, 0.2] },
  ];
  const col = { tok: 0, mcap: 214, apr: 304 };
  return (
    <Box>
      <div style={{ display: "flex", flexDirection: "column", width: MW }}>
        <div style={{ display: "flex", paddingBottom: 12, borderBottom: `1px solid ${C.lineStrong}` }}>
          <div style={{ display: "flex", width: col.mcap }}><Label>TOKEN</Label></div>
          <div style={{ display: "flex", width: col.apr - col.mcap }}><Label>MCAP</Label></div>
          <Label>APR 24H · 3D</Label>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", height: 46, borderBottom: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, width: col.mcap }}>
              <div style={{ width: 24, height: 24, borderRadius: 12, background: SURFACE2, border: `1px solid ${C.lineStrong}` }} />
              <div style={{ width: r.name, height: 10, borderRadius: 3, background: SURFACE2 }} />
            </div>
            <div style={{ display: "flex", width: col.apr - col.mcap }}>
              <div style={{ width: 52, height: 10, borderRadius: 3, background: C.line }} />
            </div>
            {r.apr ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ width: 130 * r.apr[0], height: 7, borderRadius: 2, background: C.accent }} />
                <div style={{ width: 130 * r.apr[1], height: 7, borderRadius: 2, background: C.accent, opacity: 0.45 }} />
              </div>
            ) : (
              <div style={{ ...mono, fontSize: 18, color: C.ink3, display: "flex" }}>—</div>
            )}
          </div>
        ))}
        <div style={{ display: "flex", marginTop: 14 }}><Label>— = STANDARD COIN, NO HOLDER FEES</Label></div>
      </div>
    </Box>
  );
}

// Pairs: coins on the left wired to the quote asset they are priced in.
function PairsMotif() {
  const quotes = [
    { label: "SOL", color: S[0] },
    { label: "USDC", color: S[2] },
    { label: "SPYx", color: S[3] },
    { label: "STONK", color: S[6] },
  ];
  const qx = MW - 120;
  const qy = (i: number) => 34 + i * 76;
  const coins = 11;
  const cy = (i: number) => 14 + i * ((MH - 60) / (coins - 1));
  const link = [0, 1, 0, 2, 3, 0, 1, 2, 0, 3, 2];
  return (
    <Box>
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`}>
        {link.map((q, i) => {
          const x0 = 22;
          const y0 = cy(i);
          const x1 = qx - 16;
          const y1 = qy(q);
          const m = (x0 + x1) / 2;
          return <path key={i} d={`M ${x0} ${y0} C ${m} ${y0}, ${m} ${y1}, ${x1} ${y1}`} fill="none" stroke={quotes[q].color} strokeOpacity={0.55} strokeWidth={1.6} />;
        })}
        {Array.from({ length: coins }, (_, i) => <circle key={i} cx={12} cy={cy(i)} r={9} fill={SURFACE2} stroke={C.lineStrong} strokeWidth={1} />)}
        {quotes.map((q, i) => <circle key={q.label} cx={qx} cy={qy(i)} r={14} fill={C.surface} stroke={q.color} strokeWidth={3} />)}
      </svg>
      {quotes.map((q, i) => (
        <Abs key={q.label} x={qx + 26} y={qy(i) - 11}><div style={{ ...mono, fontSize: 18, fontWeight: 500, color: C.ink, display: "flex" }}>{q.label}</div></Abs>
      ))}
      <Abs x={0} y={MH - 22}><Label>COINS → THE QUOTE ASSET THEY TRADE AGAINST</Label></Abs>
    </Box>
  );
}

// Launches: progress to the graduation line; two rows have crossed it.
function LaunchesMotif() {
  const prog = [0.18, 1, 0.42, 0.08, 0.66, 0.27, 1, 0.12, 0.35];
  const barW = 290;
  const rowH = 30;
  return (
    <Box>
      <div style={{ display: "flex", flexDirection: "column", width: MW, paddingTop: 28 }}>
        {prog.map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", height: rowH, gap: 12 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: SURFACE2, border: `1px solid ${C.lineStrong}` }} />
            <div style={{ display: "flex", width: barW, height: 8, borderRadius: 2, background: C.line }}>
              <div style={{ width: barW * p, height: 8, borderRadius: 2, background: p >= 1 ? C.bull : S[0], opacity: p >= 1 ? 1 : 0.85 }} />
            </div>
            {p >= 1 && <div style={{ display: "flex", flexShrink: 0, marginLeft: 6 }}><Pill color={C.bull}>graduated</Pill></div>}
          </div>
        ))}
      </div>
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`} style={{ position: "absolute", left: 0, top: 0 }}>
        <line x1={28 + barW} x2={28 + barW} y1={20} y2={28 + prog.length * rowH + 4} stroke={C.ink2} strokeWidth={1.5} strokeDasharray="4 5" />
      </svg>
      <Abs x={28 + barW - 46} y={0}><Label color={C.ink2}>GRADUATION</Label></Abs>
      <Abs x={0} y={MH - 22}><Label>NEWEST FIRST · PROGRESS TO GRADUATION</Label></Abs>
    </Box>
  );
}

// Runners: the six market-cap lines on a log scale, three tokens climbing through them; dots where they cross.
function RunnersMotif() {
  const lines = [1, 5, 10, 25, 50, 100];
  const top = 8;
  const bottom = MH - 40;
  const lo = Math.log10(0.4);
  const hi = Math.log10(130);
  const y = (m: number) => bottom - ((Math.log10(m) - lo) / (hi - lo)) * (bottom - top);
  const plotW = MW - 70;
  // Peaks (in $M) at a few x positions: shapes, not data.
  const paths = [
    { color: S[0], pts: [[0, 0.5], [0.15, 0.7], [0.3, 1.6], [0.42, 1.2], [0.55, 3.8], [0.7, 7.5], [0.82, 6.1], [1, 14]] },
    { color: S[2], pts: [[0.1, 0.45], [0.25, 0.6], [0.4, 2.2], [0.55, 5.6], [0.65, 4.4], [0.78, 21], [0.9, 38], [1, 62]] },
    { color: S[6], pts: [[0.35, 0.5], [0.5, 0.9], [0.62, 1.4], [0.75, 1.1], [0.88, 1.9], [1, 2.6]] },
  ];
  const crossings: { x: number; y: number }[] = [];
  for (const p of paths) {
    const done = new Set<number>();
    for (let i = 1; i < p.pts.length; i++) {
      const [x0, v0] = p.pts[i - 1];
      const [x1, v1] = p.pts[i];
      for (const l of lines) {
        if (!done.has(l) && v0 < l && v1 >= l) {
          done.add(l); // once per token per line, like the page
          const t = (Math.log10(l) - Math.log10(v0)) / (Math.log10(v1) - Math.log10(v0));
          crossings.push({ x: (x0 + t * (x1 - x0)) * plotW, y: y(l) });
        }
      }
    }
  }
  return (
    <Box>
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`}>
        {lines.map((l) => <line key={l} x1={0} x2={plotW} y1={y(l)} y2={y(l)} stroke={C.lineStrong} strokeWidth={1} strokeDasharray="3 5" />)}
        {paths.map((p) => (
          <path key={p.color} d={p.pts.map(([x, v], i) => `${i ? "L" : "M"} ${(x * plotW).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")} fill="none" stroke={p.color} strokeWidth={2.5} strokeLinejoin="round" />
        ))}
        {crossings.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={5} fill={C.bg} stroke={C.ink} strokeWidth={2} />)}
      </svg>
      {lines.map((l) => (
        <Abs key={l} x={plotW + 12} y={y(l) - 10}><div style={{ ...mono, fontSize: 16, fontWeight: 500, color: C.ink2, display: "flex" }}>{`$${l}M`}</div></Abs>
      ))}
      <Abs x={0} y={MH - 22}><Label>MARKET CAP, LOG SCALE · ○ = A CROSSING</Label></Abs>
    </Box>
  );
}

// Rewards: the wallet check box over a cumulative payout curve (payouts pushed to the wallet as ticks).
function RewardsMotif() {
  // Payouts land at irregular times and in uneven sizes.
  const inc = [1, 0.4, 2.2, 0.6, 0.3, 1.5, 0.8, 2.8, 0.5, 0.4, 1.9, 0.7, 3.1, 0.6, 1.2, 0.4, 2.4, 0.9, 0.5, 1.7, 0.6, 2.0];
  const gaps = [1.2, 0.6, 1.8, 0.9, 0.5, 1.4, 1.1, 0.7, 2.0, 0.6, 0.9, 1.5, 0.8, 0.5, 1.3, 1.0, 0.6, 1.7, 0.9, 0.7, 1.2, 0.8];
  const x0 = 0;
  const w = MW;
  const base = MH - 40;
  const gTotal = gaps.reduce((a, g) => a + g, 0);
  let acc = 0;
  let gx = 0;
  const steps = inc.map((v, i) => {
    acc += v;
    gx += gaps[i];
    return { x: x0 + (gx / gTotal) * w, v: acc };
  });
  const max = acc;
  const Y = (v: number) => base - (v / max) * 170;
  let d = `M ${x0} ${base}`;
  let prevY = base;
  for (const s of steps) {
    d += ` L ${s.x.toFixed(1)} ${prevY.toFixed(1)} L ${s.x.toFixed(1)} ${Y(s.v).toFixed(1)}`;
    prevY = Y(s.v);
  }
  const area = `${d} L ${w} ${base} Z`;
  return (
    <Box>
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`}>
        <path d={area} fill={C.bull} fillOpacity={0.08} />
        <path d={d} fill="none" stroke={C.bull} strokeWidth={2.5} strokeLinejoin="round" />
        <line x1={0} x2={MW} y1={base} y2={base} stroke={C.lineStrong} strokeWidth={1} />
        {steps.map((s, i) => <line key={i} x1={s.x} x2={s.x} y1={base + 6} y2={base + 14} stroke={C.ink3} strokeWidth={1.5} />)}
      </svg>
      <Abs x={0} y={0} style={{ width: MW, gap: 10 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", height: 52, padding: "0 16px", border: `1px solid ${C.lineStrong}`, borderRadius: 6, background: C.surface, ...mono, fontSize: 17, color: C.ink3 }}>paste a wallet address</div>
        <div style={{ display: "flex", alignItems: "center", height: 52, padding: "0 20px", borderRadius: 6, background: C.ink, color: C.bg, fontSize: 18, fontWeight: 600 }}>Check</div>
      </Abs>
      <Abs x={0} y={MH - 22}><Label>PAID TO THE WALLET · NOTHING TO CLAIM</Label></Abs>
    </Box>
  );
}

// Holders: wallets as dots on orbits, one colour per quote-asset category (fixed order).
function HoldersMotif() {
  const cx = MW / 2;
  const cy = 148;
  const rings = [46, 88, 130];
  const r = seq(23, 64);
  const dots: { x: number; y: number; c: string; s: number }[] = [];
  let k = 0;
  rings.forEach((R, ri) => {
    const n = [10, 18, 26][ri];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r[k % r.length] * 0.35 + ri;
      const j = (r[(k + 7) % r.length] - 0.5) * 10;
      dots.push({ x: cx + (R + j) * Math.cos(a), y: cy + (R + j) * Math.sin(a), c: S[Math.floor(r[(k + 3) % r.length] * 5)], s: 3.5 + r[(k + 5) % r.length] * 3.5 });
      k++;
    }
  });
  return (
    <Box>
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`}>
        {rings.map((R) => <circle key={R} cx={cx} cy={cy} r={R} fill="none" stroke={C.line} strokeWidth={1} />)}
        {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.s} fill={d.c} />)}
        <circle cx={cx} cy={cy} r={14} fill={C.surface} stroke={C.lineStrong} strokeWidth={2} />
      </svg>
      <Abs x={0} y={MH - 22}><Label>QUOTE ASSETS · HOLDERS · WHO STONKFUN PAYS</Label></Abs>
    </Box>
  );
}

// About: the scoring states as the site draws them — tally bar, then state-striped cells with their source lines.
function AboutMotif() {
  const tally = ["bull", "bull", "neutral", "bull", "caution", "bull", "neutral", "info", "bull", "caution", "bull", "info"];
  const col: Record<string, string> = { bull: C.bull, neutral: C.neutral, caution: C.caution };
  const cells = [
    { state: "bullish", color: C.bull, src: "StonkFun revenue · 30s", w: 150 },
    { state: "neutral", color: C.neutral, src: "Raydium · 60s", w: 120 },
    { state: "caution", color: C.caution, src: "stonk.fyi pool snapshots · 5 min", w: 170 },
  ];
  return (
    <Box>
      <div style={{ display: "flex", flexDirection: "column", width: MW }}>
        <div style={{ display: "flex", gap: 5, height: 16 }}>
          {tally.map((s, i) => <div key={i} style={{ flex: 1, borderRadius: 3, background: col[s] ?? "transparent", border: s === "info" ? `1px dashed ${C.lineStrong}` : "none" }} />)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
          {cells.map((c) => (
            <div key={c.state} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "11px 16px", background: C.surface, border: `1px solid ${C.line}`, borderLeft: `3px solid ${c.color}`, borderRadius: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ width: c.w, height: 10, borderRadius: 3, background: SURFACE2 }} />
                <Pill color={c.color}>{c.state}</Pill>
              </div>
              <div style={{ ...mono, fontSize: 14, color: C.ink3, display: "flex" }}>{c.src}</div>
            </div>
          ))}
        </div>
      </div>
      <Abs x={0} y={MH - 22}><Label>EVERY NUMBER: A STATE, A THRESHOLD, A SOURCE</Label></Abs>
    </Box>
  );
}

// ---- pages ----------------------------------------------------------------

const MOTIFS: Record<PageKey, () => ReactNode> = {
  platform: PlatformMotif,
  flywheel: FlywheelMotif,
  tokens: TokensMotif,
  pairs: PairsMotif,
  launches: LaunchesMotif,
  runners: RunnersMotif,
  rewards: RewardsMotif,
  holders: HoldersMotif,
  about: AboutMotif,
};

// Title size steps down with length so long titles stay on two lines in the 580px column.
const titleSize = (t: string) => (t.length <= 10 ? 96 : t.length <= 16 ? 76 : t.length <= 26 ? 64 : 56);

export function PageCard({ page }: { page: PageKey }) {
  const p = PAGE_SPECS[page];
  const Motif = MOTIFS[page];
  const fs = titleSize(p.cardTitle);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist" }}>
      {/* masthead: same as the home card, with the page's place in the nav on the right */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "30px 56px 22px", borderBottom: `1px solid ${C.line}` }}>
        <Ring pct={13} /* fixed bite, as in icon.svg */ size={30} stroke={C.accent} track={C.line} width={6} />
        <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        <div style={{ ...mono, fontSize: 13, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 8px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
        <div style={{ ...mono, fontSize: 17, fontWeight: 500, letterSpacing: 1.5, marginLeft: "auto", display: "flex", gap: 10 }}>
          {p.group && <span style={{ color: C.ink3 }}>{p.group.toUpperCase()}</span>}
          {p.group && <span style={{ color: C.lineStrong }}>/</span>}
          <span style={{ color: C.accent }}>{p.label.toUpperCase()}</span>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, alignItems: "center", padding: "0 56px", gap: 52 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 596 }}>
          {/* satori (next/og) widens a plain space before "&"; a no-break space renders at normal width */}
          <div style={{ fontSize: fs, fontWeight: 600, letterSpacing: fs > 80 ? -4 : -2.5, lineHeight: 1.02 }}>{p.cardTitle.replace(/ &/g, "\u00a0&")}</div>
          <div style={{ fontSize: 26, color: C.ink2, lineHeight: 1.38, marginTop: 24 }}>{p.description}</div>
        </div>
        <div style={{ display: "flex", marginLeft: "auto" }}>
          <Motif />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 56px 22px", borderTop: `1px solid ${C.line}`, ...mono, fontSize: 17, color: C.ink3 }}>
        <div style={{ display: "flex" }}>
          <span style={{ color: C.ink2 }}>{`stonk.fyi${p.path}`}</span>
        </div>
        <div style={{ display: "flex" }}>live · source-linked · not financial advice</div>
      </div>
    </div>
  );
}
