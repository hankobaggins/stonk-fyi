import "server-only";

// Helius DAS client — only what the wallet census (lib/wallets.ts) needs. Optional: every function
// throws a clear error when HELIUS_API_KEY is unset, and the worker step reports it.
// Docs: https://www.helius.dev/docs/api-reference/das/gettokenaccounts. Free plan: 1M credits/month,
// DAS at 2 requests/s, 10 credits a call; each page is ≤1000 token accounts.

const KEY = () => process.env.HELIUS_API_KEY;
const URL = () => `${process.env.HELIUS_RPC_URL ?? "https://mainnet.helius-rpc.com"}/?api-key=${KEY()}`;
const PAGE = 1000;
const GAP_MS = Math.max(0, Number(process.env.HELIUS_GAP_MS ?? 550)); // 550 stays under the free plan's 2 DAS requests per second; lower it on a paid plan

type TokenAccount = { address: string; mint: string; owner: string; amount: number; frozen?: boolean; burnt?: boolean };
type Page = { total: number; limit: number; cursor?: string | null; token_accounts: TokenAccount[] };

let lastCallAt = 0;
async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
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
      signal: AbortSignal.timeout(30_000),
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

export type MintOwners = { owners: Set<string>; accounts: number; pages: number };

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
    if (!page.cursor || (page.token_accounts?.length ?? 0) < PAGE || pages >= maxPages) break;
    cursor = page.cursor;
  }
  return { owners, accounts, pages };
}
