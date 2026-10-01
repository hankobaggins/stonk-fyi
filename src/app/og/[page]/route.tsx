import { ImageResponse } from "next/og";
import { cardFonts } from "@/lib/card";
import { PageCard } from "@/lib/page-card";
import { isPageKey, PAGE_KEYS } from "@/lib/page-meta";
import { OG_SIZE } from "@/lib/site";

// GET /og/{page} → 1200×630 PNG, the static title card for one of the static pages (lib/page-meta.ts lists them).
// No live data, so the cards are rendered once at build time and served as static files; unknown keys 404.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return PAGE_KEYS.map((page) => ({ page }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ page: string }> }) {
  const { page } = await ctx.params;
  if (!isPageKey(page)) return new Response("not found", { status: 404 });
  return new ImageResponse(<PageCard page={page} />, { ...OG_SIZE, fonts: await cardFonts() });
}
