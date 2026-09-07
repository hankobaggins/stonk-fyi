import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
    { path: "/", priority: 1, freq: "hourly" },
    { path: "/platform", priority: 0.8, freq: "hourly" },
    { path: "/tokens", priority: 0.7, freq: "hourly" },
    { path: "/pairs", priority: 0.6, freq: "daily" },
    { path: "/flywheel", priority: 0.7, freq: "hourly" },
    { path: "/launches", priority: 0.6, freq: "hourly" },
    { path: "/about", priority: 0.5, freq: "monthly" },
  ];
  return pages.map((p) => ({ url: `${SITE_URL}${p.path}`, lastModified: now, changeFrequency: p.freq, priority: p.priority }));
}
