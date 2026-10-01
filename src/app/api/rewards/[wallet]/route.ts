import { isWalletAddress } from "@/lib/wallet-rewards-math";
import { scanWallet } from "@/lib/wallet-rewards";

// GET /api/rewards/{wallet} → NDJSON stream of the wallet rewards scan (§6o): one `progress` line per page of history
// read (the whole view each time, so the page just replaces what it shows), then `done` with the reason the scan
// stopped (`complete`, `fresh`, `time` / `rationed` = more to read, re-request to continue, `elsewhere`), or `error`.
// `?force=1` skips the 10-minute freshness window. Nothing here is cached.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  if (!isWalletAddress(wallet)) return new Response(JSON.stringify({ type: "error", message: "not a Solana wallet address" }) + "\n", { status: 400, headers: { "content-type": "application/x-ndjson" } });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of scanWallet(wallet, { force })) controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({ type: "error", message: (e as Error).message, view: null }) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
