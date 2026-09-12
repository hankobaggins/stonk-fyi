import "server-only";

// HolderScan API client (https://docs.holderscan.com/api/intro) — only what the universe holder
// step needs. Optional: `HOLDERSCAN_API_KEY` unset → every call reports an error and the worker step
// records nothing. Base https://api.holderscan.com/v0, header `x-api-key`. Standard plan (bundled with
// HolderScan Premium): 200K request units a month, 300 requests a minute, 1 key. The holders route
// costs 10 units, so one reading of ~320 mints a day is ~96K units a month; hourly would need the
// Advanced plan. Beta API with a "supported tokens" list — a mint HolderScan does not track answers
// 404 and is reported as "no reading", never as zero.

const BASE = process.env.HOLDERSCAN_API_BASE ?? "https://api.holderscan.com/v0";
const KEY = () => process.env.HOLDERSCAN_API_KEY;
export const HOLDERSCAN_GAP_MS = Math.max(0, Number(process.env.HOLDERSCAN_GAP_MS ?? 250)); // 300/min → one every 200 ms; 250 leaves headroom

export const holderscanEnabled = () => !!KEY();

export type HolderCountRead = { holders: number | null; error: string | null };

let lastCallAt = 0;
async function get<T>(path: string): Promise<{ status: number; body: T | null; text: string }> {
  if (!KEY()) throw new Error("HOLDERSCAN_API_KEY not set");
  const wait = lastCallAt + HOLDERSCAN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers: { "x-api-key": KEY()!, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 4_000 * (attempt + 1)));
      continue;
    }
    const text = await res.text().catch(() => "");
    let body: T | null = null;
    try { body = text ? (JSON.parse(text) as T) : null; } catch { body = null; }
    return { status: res.status, body, text };
  }
}

// Current holder count for a Solana mint: `GET /sol/tokens/{mint}/holders?limit=1` → `holder_count`
// (10 units; the holder list itself is not used). 404 = not tracked by HolderScan.
export async function getHolderscanHolderCount(mint: string): Promise<HolderCountRead> {
  try {
    const r = await get<{ holder_count?: number; total?: number; message?: string; error?: string }>(`/sol/tokens/${mint}/holders?limit=1`);
    if (r.status === 404) return { holders: null, error: "not tracked by HolderScan" };
    if (r.status !== 200) return { holders: null, error: `HTTP ${r.status} ${(r.body?.message ?? r.body?.error ?? r.text).toString().slice(0, 120)}` };
    const n = r.body?.holder_count;
    if (typeof n !== "number" || !Number.isFinite(n)) return { holders: null, error: `unexpected shape: ${r.text.slice(0, 120)}` };
    return { holders: Math.round(n), error: null };
  } catch (e) {
    return { holders: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export type HolderDeltas = { d7: number | null; d14: number | null; d30: number | null };

// HolderScan's own change in holder count over 7 / 14 / 30 days: `GET /sol/tokens/{mint}/holders/deltas`
// → `{ "7days": -12, "14days": 100, "30days": 150 }` (20 units; no 24h figure exists on this route).
export async function getHolderscanDeltas(mint: string): Promise<{ deltas: HolderDeltas | null; error: string | null }> {
  try {
    const r = await get<Record<string, unknown>>(`/sol/tokens/${mint}/holders/deltas`);
    if (r.status === 404) return { deltas: null, error: "not tracked by HolderScan" };
    if (r.status !== 200) return { deltas: null, error: `HTTP ${r.status} ${r.text.slice(0, 120)}` };
    const num = (k: string) => (typeof r.body?.[k] === "number" && Number.isFinite(r.body[k] as number) ? Math.round(r.body[k] as number) : null);
    const deltas = { d7: num("7days"), d14: num("14days"), d30: num("30days") };
    if (deltas.d7 === null && deltas.d14 === null && deltas.d30 === null) return { deltas: null, error: `unexpected shape: ${r.text.slice(0, 120)}` };
    return { deltas, error: null };
  } catch (e) {
    return { deltas: null, error: e instanceof Error ? e.message : String(e) };
  }
}
