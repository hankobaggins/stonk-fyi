import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { cardFonts } from "@/lib/card";
import { getDb } from "@/lib/db";
import { getMilestone, type MilestoneRow } from "@/lib/burn-milestones";
import { MilestoneCard, MILESTONE_CARD_SIZE, type MilestoneCardProps } from "@/lib/milestone-card";
import { findCrossing, milestoneFloor } from "@/lib/milestone-math";
import { getStonkData, STONK_INITIAL_SUPPLY } from "@/lib/stonk";

// GET /milestone-card/{pct}   → 1200×1200 PNG for the stored "{pct}% of supply burned" milestone (what gets posted; kept as provenance)
// GET /milestone-card/preview → same card from live data at the current whole percent (for eyeballing; nothing stored)
export const dynamic = "force-dynamic";

function fromRow(r: MilestoneRow): MilestoneCardProps {
  return {
    pct: r.pct,
    supplyBurnedPct: r.supply_burned_pct,
    burnedTokens: r.burned_tokens,
    burnedValueUsd: r.burned_value_usd,
    reachedAt: r.reached_at,
    prevReachedAt: r.prev_reached_at,
    velocityPctDay: r.velocity_pct_day,
    velocitySignal: r.velocity_signal ?? "info",
    at: r.ts,
  };
}

async function preview(): Promise<MilestoneCardProps | null> {
  const d = await getStonkData();
  if (!d.burns) return null;
  const pct = milestoneFloor(d.supply.burnedPct);
  const crossing = findCrossing(d.burns.burns, d.supply.burned, STONK_INITIAL_SUPPLY, pct);
  const v = d.indicators.find((i) => i.key === "burnrate");
  return {
    pct,
    supplyBurnedPct: d.supply.burnedPct,
    burnedTokens: d.supply.burned,
    burnedValueUsd: d.burns.totals.valueUsdAtBurn ?? null,
    reachedAt: crossing.reachedAt,
    prevReachedAt: null,
    velocityPctDay: d.burnRate?.pctSupplyPerDay ?? null,
    velocitySignal: v?.signal ?? "info",
    at: d.generatedAt,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let props: MilestoneCardProps | null = null;
  if (id === "preview") {
    props = await preview();
  } else {
    const db = getDb();
    if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });
    const pct = Number(id);
    if (!Number.isInteger(pct) || pct <= 0 || pct > 100) return NextResponse.json({ error: "bad milestone" }, { status: 400 });
    const row = await getMilestone(db, pct);
    if (row && row.status !== "seeded" && row.status !== "skipped") props = fromRow(row);
  }
  if (!props) return NextResponse.json({ error: "not found" }, { status: 404 });

  const fonts = await cardFonts();
  return new ImageResponse(<MilestoneCard {...props} />, {
    ...MILESTONE_CARD_SIZE,
    fonts,
    headers: { "Cache-Control": id === "preview" ? "no-store" : "public, max-age=0, s-maxage=86400, immutable" },
  });
}
