import { NextRequest } from "next/server";

// Icon proxy with a long CDN cache. Token images live on third-party hosts (gateway.irys.xyz
// serves ~80% of them) that go down or crawl; once an icon has been fetched successfully it is
// served from Vercel's edge cache for a week, so an upstream outage stops blanking the tables.
// Failures are cached briefly so a dead host is not hammered on every page view.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Any public https host is fine (StonkFun creators use a long tail of image hosts); only
// literal IPs and local names are refused so the proxy cannot be pointed at internal services.
const BLOCKED = /^(localhost|.*\.local|.*\.internal|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/i;
const MAX_BYTES = 2 * 1024 * 1024;

function allowed(host: string) {
  return host.includes(".") && !BLOCKED.test(host);
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  let target: URL;
  try {
    target = new URL(u ?? "");
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || !allowed(target.hostname)) return new Response("host not allowed", { status: 400 });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(target, { signal: ctrl.signal, headers: { accept: "image/*" }, cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return fail(`${res.status} ${type}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return fail("too large");
    return new Response(buf, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000, stale-if-error=2592000",
        "x-icon-source": target.hostname,
      },
    });
  } catch (e) {
    return fail((e as Error).name === "AbortError" ? "timeout" : (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

// 502 with a short cache: the <img onError> fallback shows initials, and the edge retries in 5 min.
function fail(reason: string) {
  return new Response(reason, { status: 502, headers: { "cache-control": "public, max-age=60, s-maxage=300", "x-icon-error": reason } });
}
