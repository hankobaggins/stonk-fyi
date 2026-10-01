-- 0022: wallet rewards check (/rewards/{wallet}, CLAUDE.md §6o). One row per wallet someone has looked up: what StonkFun's
-- holder-reward distributor has paid it, aggregated from an on-chain scan (Helius getTransactionsForAddress). Only totals
-- are kept — per-asset sums, per-day sums and the last 25 payouts — never the wallet's other activity. The scan is
-- incremental: `last_slot` is the highest slot fully read, `cursor` the Helius paginationToken of a pass that ran out of
-- budget, so a refresh reads only what is new. `lock_until` stops two requests scanning the same wallet at once (the
-- second would add the same payouts twice). Paste into the SQL editor by hand.

create table if not exists public.wallet_rewards (
  wallet        text primary key,
  created_at    timestamptz not null default now(),
  scanned_at    timestamptz,                    -- end of the newest scan pass (complete or not)
  complete      boolean not null default false, -- true once a pass reached the chain tip
  last_slot     bigint,                         -- highest slot fully read
  cursor        text,                           -- paginationToken to resume an unfinished pass
  pass_from     bigint,                         -- the slot filter the unfinished pass started from (null = from genesis)
  txs_scanned   bigint not null default 0,
  credits       bigint not null default 0,      -- Helius credits spent on this wallet, lifetime
  payouts       integer not null default 0,
  first_at      timestamptz,
  last_at       timestamptz,
  assets        jsonb not null default '{}'::jsonb,   -- { mint: { raw, decimals, payouts, first, last, symbol } }
  days          jsonb not null default '{}'::jsonb,   -- { "YYYY-MM-DD": { mint: raw } }
  recent        jsonb not null default '[]'::jsonb,   -- newest 25 payouts [{ sig, ts, mint, raw, decimals }]
  coins         jsonb not null default '[]'::jsonb,   -- reward coins held at the last scan [{ mint, quote }]
  lock_until    timestamptz,
  error         text
);

create index if not exists wallet_rewards_scanned_at on public.wallet_rewards (scanned_at desc);
alter table public.wallet_rewards enable row level security;
