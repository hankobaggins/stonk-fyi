import { readFile } from "node:fs/promises";
import path from "node:path";

// Shared by every next/og card (social card, burn announcement).
// Ledger palette, mirrored from globals.css (next/og can't read CSS variables).
export const C = { bg: "#0a1317", surface: "#101c21", line: "#1f333b", lineStrong: "#2c4550", ink: "#edf4f5", ink2: "#a7babf", ink3: "#66797f", accent: "#7cc0d4", bull: "#37c27e", neutral: "#8fa3a8", caution: "#e0a53c", down: "#ef6b6b", burn: "#d95926" };

const FONT_DIR = path.join(process.cwd(), "node_modules/geist/dist/fonts");
export async function cardFonts() {
  const [sans, sansSemi, mono, monoMed] = await Promise.all([
    readFile(path.join(FONT_DIR, "geist-sans/Geist-Regular.ttf")),
    readFile(path.join(FONT_DIR, "geist-sans/Geist-SemiBold.ttf")),
    readFile(path.join(FONT_DIR, "geist-mono/GeistMono-Regular.ttf")),
    readFile(path.join(FONT_DIR, "geist-mono/GeistMono-Medium.ttf")),
  ]);
  return [
    { name: "Geist", data: sans, weight: 400 as const, style: "normal" as const },
    { name: "Geist", data: sansSemi, weight: 600 as const, style: "normal" as const },
    { name: "Geist Mono", data: mono, weight: 400 as const, style: "normal" as const },
    { name: "Geist Mono", data: monoMed, weight: 500 as const, style: "normal" as const },
  ];
}

// The burn ring at OG scale: the bite is the burned share of supply.
export function Ring({ pct, size, stroke, track, width }: { pct: number; size: number; stroke: string; track: string; width: number }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min(0.95, Math.max(0.04, pct / 100));
  const h = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={h} cy={h} r={r} fill="none" stroke={track} strokeWidth={width} />
      <circle cx={h} cy={h} r={r} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={`${c * (1 - frac)} ${c * frac}`} strokeDashoffset={-c * frac} transform={`rotate(-90 ${h} ${h})`} />
    </svg>
  );
}

