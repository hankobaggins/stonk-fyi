export function fmtUsd(n?: number | null, opts: { compact?: boolean; digits?: number } = {}): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const { compact = true } = opts;
  const abs = Math.abs(n);
  if (compact) {
    if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  }
  if (abs > 0 && abs < 0.01) return `$${n.toPrecision(3)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: opts.digits ?? 2, minimumFractionDigits: abs >= 1 ? 2 : 0 })}`;
}

export function fmtPrice(n?: number | null): string {
  if (n === undefined || n === null) return "—";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  // sub-cent: show significant digits with a subscript-style zero count
  const s = n.toFixed(12);
  const m = s.match(/^0\.(0*)(\d{1,4})/);
  if (!m) return `$${n.toPrecision(3)}`;
  const zeros = m[1].length;
  return zeros >= 3 ? `$0.0${subscript(zeros)}${m[2]}` : `$${n.toPrecision(4)}`;
}

function subscript(n: number): string {
  const map = "₀₁₂₃₄₅₆₇₈₉";
  return String(n).split("").map((c) => map[Number(c)]).join("");
}

export function fmtNum(n?: number | null, digits = 0): string {
  if (n === undefined || n === null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtPct(n?: number | null, digits = 1): string {
  if (n === undefined || n === null) return "—";
  const sign = n > 0 ? "+" : "";
  if (Math.abs(n) >= 1000) return `${sign}${(n / 1000).toFixed(1)}K%`;
  return `${sign}${n.toFixed(digits)}%`;
}

export function timeAgo(iso?: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function shortAddr(a?: string, n = 4): string {
  if (!a) return "—";
  return a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function fmtDay(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Server components render once per request; reading the clock there is fine,
// but the React Compiler lint treats Date.now() as impure, so route it through here.
export const nowMs = (): number => Date.now();

export function cumulative<T extends { date: string }>(rows: T[], pick: (r: T) => number): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  let acc = 0;
  for (const r of rows) {
    acc += pick(r);
    out.push({ date: r.date, value: acc });
  }
  return out;
}
