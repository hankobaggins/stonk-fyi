import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { cardFonts } from "@/lib/card";
import { getDb } from "@/lib/db";
import { FIRE_CARD_SIZE, FireCard, type FireCardProps } from "@/lib/fire-card";
import { getVelocityAlert, type VelocityRow } from "@/lib/velocity-alerts";
import { FIRE_ALERT_THRESHOLD_PCT, VELOCITY_ALERT_THRESHOLD_PCT } from "@/lib/velocity-math";
import { getStonkData } from "@/lib/stonk";

// GET /fire-card/{id}     → 1200×1200 PNG for a stored "burns are on fire" alert (what gets posted; kept as provenance)
// GET /fire-card/preview  → same card from live data, whatever the current velocity (for eyeballing; nothing stored)
export const dynamic = "force-dynamic";

function fromRow(r: VelocityRow): FireCardProps {
  return {
    pctDay: r.pct_day,
    thresholdPct: r.threshold_pct,
    heatingPct: VELOCITY_ALERT_THRESHOLD_PCT,
    prevPctDay: r.prev_pct_day,
    prevTs: r.prev_ts,
    windowHours: r.window_hours,
    windowTokens: r.window_tokens,
    windowUsd: r.window_usd,
    windowBurns: r.window_burns,
    tokensPerHour: r.tokens_per_hour,
    supplyBurnedPct: r.supply_burned_pct ?? 0,
    at: r.ts,
  };
}

async function preview(): Promise<FireCardProps> {
  const d = await getStonkData();
  const b = d.burnRate;
  return {
    pctDay: b?.pctSupplyPerDay ?? 0,
    thresholdPct: FIRE_ALERT_THRESHOLD_PCT,
    heatingPct: VELOCITY_ALERT_THRESHOLD_PCT,
    prevPctDay: null,
    prevTs: null,
    windowHours: b?.windowHours ?? null,
    windowTokens: b ? b.tokensPerHour * b.windowHours : null,
    windowUsd: b ? b.usdPerHour * b.windowHours : null,
    windowBurns: b?.sample ?? null,
    tokensPerHour: b?.tokensPerHour ?? null,
    supplyBurnedPct: d.supply.burnedPct,
    at: d.generatedAt,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let props: FireCardProps | null = null;
  if (id === "preview") {
    props = await preview();
  } else {
    const db = getDb();
    if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const row = await getVelocityAlert(db, n, "fire_alerts");
    // Only hot rows that were (or would have been) posted have a card; seeds, cool rows and quiet flips 404.
    if (row && row.state === "hot" && ["posted", "pending", "dry_run", "failed"].includes(row.status)) props = fromRow(row);
  }
  if (!props) return NextResponse.json({ error: "not found" }, { status: 404 });

  const fonts = await cardFonts();
  return new ImageResponse(<FireCard {...props} />, {
    ...FIRE_CARD_SIZE,
    fonts,
    headers: { "Cache-Control": id === "preview" ? "no-store" : "public, max-age=0, s-maxage=86400, immutable" },
  });
}
