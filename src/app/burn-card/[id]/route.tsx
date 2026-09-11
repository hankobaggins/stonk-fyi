import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { C, Ring, cardFonts } from "@/lib/card";
import { getDb } from "@/lib/db";
import { BURN_ALERT_WINDOW_MIN, getBurnAlert, findBigBurnWindow, type BurnAlertRow } from "@/lib/burn-alerts";
import { getStonkData } from "@/lib/stonk";
import { fmtNum, fmtUsd } from "@/lib/format";
import { SITE_NAME } from "@/lib/site";

// GET /burn-card/{id}      → 1600×900 PNG for burn alert {id} (what gets posted to X; kept as provenance)
// GET /burn-card/preview   → same card built from the most recent burns, threshold ignored (for eyeballing)
export const dynamic = "force-dynamic";

const SIZE = { width: 1600, height: 900 };
const mono = { fontFamily: "Geist Mono" };
const STATE: Record<string, { label: string; color: string }> = {
  bull: { label: "Bullish", color: C.bull },
  neutral: { label: "Neutral", color: C.neutral },
  bear: { label: "Caution", color: C.caution },
  info: { label: "Unscored", color: C.ink3 },
};

function stampUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

async function previewRow(): Promise<BurnAlertRow | null> {
  const d = await getStonkData();
  const burns = d.burns?.burns ?? [];
  if (!burns.length) return null;
  // Real burns from the last hour if any; otherwise the newest few, so the card always renders.
  const w =
    findBigBurnWindow(burns, { thresholdUsd: 0 }) ??
    findBigBurnWindow(burns, { thresholdUsd: 0, now: Date.parse(burns[0].burnedAt), windowMin: BURN_ALERT_WINDOW_MIN });
  if (!w) return null;
  const v = d.indicators.find((i) => i.key === "burnrate");
  return {
    id: 0,
    ts: new Date().toISOString(),
    window_start: w.windowStart,
    window_end: w.windowEnd,
    amount_tokens: w.amountTokens,
    value_usd: w.valueUsd,
    burn_count: w.burns.length,
    sources: w.sources,
    supply_burned_pct: d.supply.burnedPct,
    velocity_pct_day: d.burnRate?.pctSupplyPerDay ?? null,
    velocity_signal: v?.signal ?? "info",
    price_usd: d.token.market?.priceUsd ?? null,
    largest_signature: w.largest.signature,
    card_url: null,
    post_text: null,
    socialbu_post_id: null,
    status: "preview",
    error: null,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let row: BurnAlertRow | null = null;
  if (id === "preview") {
    row = await previewRow();
  } else {
    const db = getDb();
    if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    row = await getBurnAlert(db, n);
  }
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const fonts = await cardFonts();
  const state = STATE[row.velocity_signal ?? "info"] ?? STATE.info;
  const burnedPct = row.supply_burned_pct ?? 0;
  const vel = row.velocity_pct_day;
  const txs = row.burn_count === 1 ? "1 tx" : `${row.burn_count} txs`;
  const velocityColor = vel === null ? C.ink3 : state.color;
  const aboveLine = vel !== null && vel > 0.3;

  // Number + smaller unit on a shared baseline (Satori needs explicit line-height on both).
  const num = (value: string, unit?: string, color = C.ink, size = 48) => (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
      <div style={{ ...mono, display: "flex", fontSize: size, fontWeight: 500, letterSpacing: -size / 32, lineHeight: 1, color, whiteSpace: "nowrap" }}>{value}</div>
      {unit && <div style={{ ...mono, display: "flex", fontSize: 22, lineHeight: 1.1, color: C.ink2 }}>{unit}</div>}
    </div>
  );
  const kpi = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, gap: 18 }}>
      <div style={{ ...mono, display: "flex", fontSize: 17, letterSpacing: 2, color: C.ink3 }}>{label}</div>
      {value}
    </div>
  );
  const rule = <div style={{ width: 1, background: C.line, alignSelf: "stretch", marginRight: 40 }} />;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Geist", padding: "0 80px" }}>
        {/* masthead */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, height: 110, borderBottom: `1px solid ${C.line}` }}>
          <Ring pct={burnedPct} size={34} stroke={C.accent} track={C.line} width={7} />
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
          <div style={{ ...mono, fontSize: 14, fontWeight: 500, color: C.ink3, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 9px", letterSpacing: 1.5 }}>UNOFFICIAL</div>
          <div style={{ ...mono, fontSize: 19, color: C.ink3, marginLeft: "auto", letterSpacing: 2 }}>BURN · $STONK · SOLANA</div>
        </div>

        {/* hero: one column, left aligned */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, ...mono, fontSize: 21 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: `${state.color}22`, color: state.color, padding: "9px 16px", borderRadius: 5, fontWeight: 500 }}>
              <div style={{ width: 10, height: 10, borderRadius: 5, background: state.color }} />
              {state.label}
            </div>
            <div style={{ color: C.ink2 }}>{`Supply burned · on-chain · ${txs} in ${BURN_ALERT_WINDOW_MIN === 60 ? "1 hr" : `${BURN_ALERT_WINDOW_MIN} min`} · ${stampUtc(row.window_end)}`}</div>
          </div>
          <div style={{ display: "flex", ...mono, fontSize: 210, fontWeight: 500, letterSpacing: -12, lineHeight: 1, marginTop: 36 }}>{fmtNum(row.amount_tokens)}</div>
          <div style={{ display: "flex", alignItems: "baseline", fontSize: 60, fontWeight: 600, letterSpacing: -2, lineHeight: 1, marginTop: 28 }}>
            <span style={{ color: C.burn }}>$STONK</span>
            <span style={{ marginLeft: 18 }}>burned.</span>
          </div>
        </div>

        {/* stats */}
        <div style={{ display: "flex", borderTop: `1px solid ${C.line}`, padding: "40px 0" }}>
          {kpi("USD VALUE", num(fmtUsd(row.value_usd), undefined, C.ink, 76))}
          {rule}
          {kpi("BURN VELOCITY", vel === null ? num("—", undefined, C.ink3) : num(`${aboveLine ? "▲" : "▽"} ${vel.toFixed(2)}`, "%/day", velocityColor))}
          {rule}
          {kpi("SUPPLY BURNED", num(`${burnedPct.toFixed(2)}%`, "of 1B"))}
        </div>

        {/* footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, height: 78, ...mono, fontSize: 17, color: C.ink3 }}>
          <div style={{ display: "flex" }}>USD at StonkFun pricing · burns and tx signatures on-chain · not financial advice</div>
          <div style={{ display: "flex", color: C.accent }}>stonk.fyi</div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts,
      headers: { "Cache-Control": id === "preview" ? "no-store" : "public, max-age=0, s-maxage=86400, immutable" },
    }
  );
}
