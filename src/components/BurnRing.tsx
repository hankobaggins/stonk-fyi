// The site mark: a ring with a bite taken out equal to the share of supply burned.
// `stroke` paints the intact share, `track` the burned bite. Nav/favicon: accent ring on a dark
// track. Home-page supply chart: swap them so the burned bite is painted in the burn series color.
export default function BurnRing({
  pct,
  size = 18,
  stroke = "var(--accent)",
  track = "var(--border)",
  width,
  label,
}: {
  pct: number;
  size?: number;
  stroke?: string;
  track?: string;
  width?: number;
  label?: string;
}) {
  const w = width ?? Math.max(2, Math.round(size * 0.2));
  const r = (size - w) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min(0.95, Math.max(0.04, pct / 100));
  const half = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx={half} cy={half} r={r} fill="none" stroke={track} strokeWidth={w} />
      <circle
        cx={half} cy={half} r={r} fill="none" stroke={stroke} strokeWidth={w}
        strokeDasharray={`${c * (1 - frac)} ${c * frac}`} strokeDashoffset={-c * frac}
        transform={`rotate(-90 ${half} ${half})`}
      />
    </svg>
  );
}
