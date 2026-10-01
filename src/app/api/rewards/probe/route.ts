import { NextResponse } from "next/server";
import { getTransactionsForAddress } from "@/lib/helius";
import { isWalletAddress, type RawTx } from "@/lib/wallet-rewards-math";
import { REWARD_DISTRIBUTORS } from "@/lib/wallet-rewards";

// GET /api/rewards/probe?wallet=…&pages=3 (Bearer CRON_SECRET) — who has paid this wallet, by month (§6o first-run check).
// Reads the wallet's history from its first transaction and, for every transaction the wallet did not sign in which one
// of its balances rose, tallies the signers by month. A distributor shows up as a signer with hundreds of rows; if one
// other than REWARD_DISTRIBUTORS appears in the months before it, add it to the env list. Costs ~100 credits a page.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const signers = (tx: RawTx): string[] => {
  const keys = tx.transaction.message.accountKeys;
  const n = tx.transaction.message.header?.numRequiredSignatures ?? 0;
  return keys.flatMap((k, i) => (typeof k === "string" ? (i < n ? [k] : []) : k.signer ? [k.pubkey] : []));
};

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet") ?? "";
  if (!isWalletAddress(wallet)) return new Response("wallet?", { status: 400 });
  const maxPages = Math.min(20, Number(url.searchParams.get("pages") ?? 3));
  const tally: Record<string, Record<string, number>> = {};
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
      const s = signers(tx);
      if (s.includes(wallet) || !tx.meta) continue;
      const pre = new Map((tx.meta.preTokenBalances ?? []).map((b) => [b.accountIndex, BigInt(b.uiTokenAmount.amount)]));
      const rose = (tx.meta.postTokenBalances ?? []).some((b) => b.owner === wallet && BigInt(b.uiTokenAmount.amount) > (pre.get(b.accountIndex) ?? BigInt(0)));
      if (!rose) continue;
      const month = ts.slice(0, 7);
      for (const k of s) {
        tally[k] ??= {};
        tally[k][month] = (tally[k][month] ?? 0) + 1;
      }
    }
    token = page.paginationToken;
  } while (token && pages < maxPages);
  const bySigner = Object.entries(tally)
    .map(([signer, months]) => ({ signer, distributor: REWARD_DISTRIBUTORS.has(signer), total: Object.values(months).reduce((a, b) => a + b, 0), months }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 25);
  return NextResponse.json({ wallet, pages, txs, first, last, more: !!token, distributors: [...REWARD_DISTRIBUTORS], bySigner }, { headers: { "cache-control": "no-store" } });
}
