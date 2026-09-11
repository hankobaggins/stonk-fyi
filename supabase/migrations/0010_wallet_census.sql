-- 0010: wallet census — how many distinct wallets hold at least one stock-quoted quote asset (2026-09-11).
-- Feeds the "unique wallets" block on /holders (CLAUDE.md §6f).
--
-- Every WALLET_CENSUS_EVERY_H hours the worker pulls, via Helius DAS getTokenAccounts, every token
-- account with a non-zero balance for each of the ~80 xstock / backpack / prestock / tessera quote
-- assets, and reduces them to one row per wallet: a 4-bit mask of which issuer categories the wallet
-- holds. Only the mask histogram is stored (≤15 rows a run), never an address, and any subset of
-- issuers can be answered from it: wallets(subset) = Σ wallets where (mask & subset) ≠ 0.
--
-- Bits: 1 = xstock, 2 = backpack, 4 = prestock, 8 = tessera (STOCK_CATEGORIES order in lib/holders.ts).

create table if not exists wallet_runs (
  ts       timestamptz not null,
  mask     smallint    not null,   -- 1..15
  wallets  integer     not null,   -- distinct owners holding exactly this combination of categories
  primary key (ts, mask)
);
alter table wallet_runs enable row level security;

-- Per-run bookkeeping: which mints were counted, which failed. A run with failures undercounts;
-- the page says so. `ts` matches wallet_runs.ts.
create table if not exists wallet_run_meta (
  ts            timestamptz primary key,
  mints_ok      integer not null,
  mints_failed  integer not null,
  accounts      integer not null,   -- token accounts with a balance, before de-duplication by owner
  first_error   text,
  duration_ms   integer
);
alter table wallet_run_meta enable row level security;

-- On-chain owner count per quote asset from the same pull (distinct owners with a balance). Separate
-- from holder_snapshots (GMGN's figure) so the two series never mix. Feeds "holders by quote asset
-- over time" (roadmap).
create table if not exists wallet_mint_counts (
  mint      text        not null,
  ts        timestamptz not null,
  category  text        not null,
  owners    integer     not null,
  accounts  integer     not null,
  primary key (mint, ts)
);
alter table wallet_mint_counts enable row level security;
