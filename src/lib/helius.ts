import "server-only";
import type { RawTx } from "./wallet-rewards-math";

// Helius DAS client — only what the wallet census (lib/wallets.ts) needs. Optional: every function
// throws a clear error when HELIUS_API_KEY is unset, and the worker step reports it.
// Docs: https://www.helius.dev/docs/api-reference/das/gettokenaccounts. Free plan: 1M credits/month,
// DAS at 2 requests/s, 10 credits a call; each page is ≤1000 token accounts.

const KEY = () => process.env.HELIUS_API_KEY;
const URL = () => `${process.env.HELIUS_RPC_URL ?? "https://mainnet.helius-rpc.com"}/?api-key=${KEY()}`;
const PAGE = 1000;
// HELIUS_PLAN=free (default) paces DAS at 550 ms (under the free plan's 2 req/s); any other value (developer,
// business) at 100 ms — the paid plans allow 50+ req/s but DAS is heavier than a plain RPC call. HELIUS_GAP_MS overrides.
export const HELIUS_PAID = (process.env.HELIUS_PLAN ?? "free").toLowerCase() !== "free";
const GAP_MS = Math.max(0, Number(process.env.HELIUS_GAP_MS ?? (HELIUS_PAID ? 100 : 550)));

type TokenAccount = { address: string; mint: string; owner: string; amount: number; frozen?: boolean; burnt?: boolean };
type Page = { total: number; limit: number; cursor?: string | null; token_accounts: TokenAccount[] };

let lastCallAt = 0;
async function rpc<T>(method: string, params: Record<string, unknown> | unknown[], timeoutMs = 30_000): Promise<T> {
  if (!KEY()) throw new Error("HELIUS_API_KEY not set");
  const wait = lastCallAt + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "stonk-fyi", method, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Helius ${method} ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new Error(`Helius ${method} ${body.error.code} ${body.error.message}`);
    if (body.result === undefined) throw new Error(`Helius ${method}: empty result`);
    return body.result;
  }
}

export type MintOwners = { owners: Set<string>; accounts: number; pages: number; truncated: boolean };

// Every distinct owner with a non-zero balance of `mint`. Walks the cursor until a short page.
// `maxPages` is a runaway guard (100 pages = 100K token accounts for one mint).
export async function getMintOwners(mint: string, maxPages = 100): Promise<MintOwners> {
  const owners = new Set<string>();
  let accounts = 0;
  let pages = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await rpc<Page>("getTokenAccounts", { mint, limit: PAGE, ...(cursor ? { cursor } : {}), options: { showZeroBalance: false } });
    pages++;
    for (const a of page.token_accounts ?? []) {
      if (!(Number(a.amount) > 0) || a.burnt) continue;
      accounts++;
      owners.add(a.owner);
    }
    if (!page.cursor || (page.token_accounts?.length ?? 0) < PAGE) break;
    if (pages >= maxPages) return { owners, accounts, pages, truncated: true };
    cursor = page.cursor;
  }
  return { owners, accounts, pages, truncated: false };
}

// ---- Wallet rewards check (§6o) ----


export type TxPage = { txs: RawTx[]; paginationToken: string | null; credits: number };

// One page of a wallet's history, oldest first, including transactions that only touched its token accounts
// (`tokenAccounts: "balanceChanged"` — a payout names the holder's token account, not the wallet). Helius-only
// method; docs: helius.dev/docs/rpc/gettransactionsforaddress. Cost: 10 credits per 100 transactions returned
// (10 minimum). `slotGt` resumes after the last slot already read; `withAddress` narrows to token transfers with one
// counterparty (off by default — its matching rules are not documented precisely enough to trust for a "0 payouts"
// answer, and native SOL transfers would not match it).
// maxSupportedTransactionVersion 1 (2026-10-01): wallets that have sent a version-1 transaction made the call fail with
// -32015 at 0; the v1 JSON keeps accountKeys / header / pre- and postTokenBalances, which is all payoutsIn reads.
export async function getTransactionsForAddress(address: string, opts: { paginationToken?: string | null; slotGt?: number | null; limit?: number; withAddress?: string | null } = {}): Promise<TxPage> {
  const limit = opts.limit ?? 1000;
  const filters: Record<string, unknown> = { status: "succeeded", tokenAccounts: "balanceChanged" };
  if (opts.slotGt != null) filters.slot = { gt: opts.slotGt };
  if (opts.withAddress) filters.tokenTransfer = { with: opts.withAddress, direction: "in" };
  const result = await rpc<unknown>(
    "getTransactionsForAddress",
    [address, { transactionDetails: "full", encoding: "json", maxSupportedTransactionVersion: 1, sortOrder: "asc", limit, filters, ...(opts.paginationToken ? { paginationToken: opts.paginationToken } : {}) }],
    60_000,
  );
  const r = result as { data?: RawTx[]; transactions?: RawTx[]; paginationToken?: string | null } | RawTx[];
  const txs = Array.isArray(r) ? r : (r.data ?? r.transactions);
  if (!Array.isArray(txs)) throw new Error("Helius getTransactionsForAddress: unexpected shape");
  const token = Array.isArray(r) ? null : (r.paginationToken ?? null);
  return { txs, paginationToken: txs.length ? token : null, credits: Math.max(10, Math.ceil(txs.length / 100) * 10) };
}

// Mints `owner` holds a non-zero balance of (DAS getTokenAccounts by owner; 10 credits a page, both token programs).
export async function getOwnerMints(owner: string, maxPages = 5): Promise<{ mints: string[]; credits: number }> {
  const mints = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const page = await rpc<Page>("getTokenAccounts", { owner, limit: PAGE, ...(cursor ? { cursor } : {}), options: { showZeroBalance: false } });
    pages++;
    for (const a of page.token_accounts ?? []) if (Number(a.amount) > 0) mints.add(a.mint);
    if (!page.cursor || (page.token_accounts?.length ?? 0) < PAGE || pages >= maxPages) break;
    cursor = page.cursor;
  }
  return { mints: [...mints], credits: pages * 10 };
}
