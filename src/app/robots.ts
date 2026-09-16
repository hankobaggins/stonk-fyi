import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Query-string URLs are the sortable / filterable / paged views (?by=&dir=&page=, ?quoteMint=): an unbounded
    // space of dynamic renders that crawlers walk endlessly. The canonical pages carry no query (2026-09-16).
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/*?*"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
