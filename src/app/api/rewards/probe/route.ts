import { NextResponse } from "next/server";
import { getTransactionsForAddress } from "@/lib/helius";
import { classifyTx, isWalletAddress } from "@/lib/wallet-rewards-math";
import { getDistributors } from "@/lib/wallet-rewards";

// GET /api/rewards/probe?wallet=…&pages=3 (Bearer CRON_SECRET) — how the wallet rewards check reads one wallet (§6o).
// Walks the wallet's history from its first transaction and reports, by month, the payouts it counts (by distributor)
// and every other increase it does not count, by source and reason. A source with hundreds of plain transfers in the
// months a known distributor is silent is a distributor this site is missing. Costs ~100 credits a page; stores nothing.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet") ?? "";
  if (!isWalletAddress(wallet)) return new Response("wallet?", { status: 400 });
  const maxPages = Math.min(20, Number(url.searchParams.get("pages") ?? 3));
  const distributors = await getDistributors();
  const payouts: Record<string, Record<string, number>> = {};
  const unexplained: Record<string, Record<string, number>> = {};
  const kinds: Record<string, number> = {};
  let token: string | null = null;
  let txs = 0;
  let pages = 0;
  let first: string | null = null;
  let last: string | null = null;
  do {
    const page = await getTransactionsForAddress(wallet, { paginationToken: token });
    pages++;
    for (const tx of page.txs) {
      txs++;
      const ts = new Date((tx.blockTime ?? 0) * 1000).toISOString();
      first ??= ts;
      last = ts;
      const month = ts.slice(0, 7);
      const c = classifyTx(tx, wallet, distributors);
      kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      if (c.kind === "payout") for (const p of c.payouts) ((payouts[p.by] ??= {})[month] = (payouts[p.by][month] ?? 0) + 1);
      if (c.kind === "unexplained") {
        const k = c.source ?? "(not a plain transfer: swap, aggregator, launchpad…)";
        (unexplained[k] ??= {})[month] = (unexplained[k][month] ?? 0) + 1;
      }
    }
    token = page.paginationToken;
  } while (token && pages < maxPages);
  const top = Object.entries(unexplained)
    .map(([source, months]) => ({ source, total: Object.values(months).reduce((a, b) => a + b, 0), months }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);
  return NextResponse.json({ wallet, pages, txs, first, last, more: !!token, distributors: [...distributors], kinds, payouts, unexplained: top }, { headers: { "cache-control": "no-store" } });
}
