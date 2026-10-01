import "server-only";

// Token logos for next/og cards (§6o coin cards). Logos live on a long tail of third-party hosts in every format —
// png, jpeg, webp, gif, svg — and next/og draws only some of them, so each is fetched once, normalised to a 256×256
// PNG with sharp and handed to the card as a data URI. Anything that fails (host down, not an image, too large, sharp
// unavailable) returns null and the card draws initials instead. Cached per instance; the card routes are CDN-cached.

const BLOCKED = /^(localhost|.*\.local|.*\.internal|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/i;
const MAX_BYTES = 4 * 1024 * 1024;
const OK_MS = 6 * 3.6e6;
const FAIL_MS = 10 * 60_000;
const g = globalThis as typeof globalThis & { __logoCache?: Map<string, { at: number; uri: string | null }> };
const cache = (g.__logoCache ??= new Map());

export async function logoDataUri(url: string | null | undefined, timeoutMs = 5000): Promise<string | null> {
  if (!url) return null;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.uri ? OK_MS : FAIL_MS)) return hit.uri;
  let uri: string | null = null;
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" || !target.hostname.includes(".") || BLOCKED.test(target.hostname)) throw new Error("host");
    const res = await fetch(target, { headers: { accept: "image/*" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !(type.startsWith("image/") || type.includes("octet-stream"))) throw new Error(`${res.status} ${type}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error("too large");
    const sharp = (await import("sharp")).default;
    const png = await sharp(buf, { animated: false }).resize(256, 256, { fit: "cover" }).png().toBuffer();
    uri = `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    uri = null;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(url, { at: Date.now(), uri });
  return uri;
}
