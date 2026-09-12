-- 0011: the whole universe of quote assets — HolderScan holder counts and the reward-coin wallet
-- census (2026-09-12). Feeds the top of /holders (CLAUDE.md §6g).
--
-- quote_holder_snapshots  one HolderScan holder_count per universe quote asset per day (worker step
--                         `universe_holders`, daily full run). The universe = every quote asset with at
--                         least one reward-mode coin launched against it (317 live on 2026-09-12), so
--                         ~320 rows a day, pruned to UNIVERSE_RETENTION_DAYS (60) → ~20K rows. Kept apart
--                         from holder_snapshots (GMGN, hourly, stock assets only) so providers never mix.
-- coin_census_runs        one row per reward-coin census: distinct wallets holding at least one of the
--                         covered reward coins (Helius DAS, deduplicated by owner in memory, no address stored),
--                         and how much of StonkFun's holder-slot total the covered coins represent.
-- coin_census_quotes      per run and quote asset: distinct wallets holding any covered coin quoted in it.

create table if not exists quote_holder_snapshots (
  mint      text        not null,
  ts        timestamptz not null,
  category  text        not null,
  holders   integer     not null,
  source    text        not null default 'holderscan',
  primary key (mint, ts)
);
alter table quote_holder_snapshots enable row level security;

create or replace function quote_holder_window(win_hours integer, mints text[])
returns table (mint text, from_ts timestamptz, to_ts timestamptz, from_holders integer, to_holders integer)
language sql stable as $$
  select m.mint,
         coalesce(b.ts, e.ts), l.ts,
         coalesce(b.holders, e.holders), l.holders
  from unnest(mints) as m(mint)
  cross join lateral (
    select ts, holders from quote_holder_snapshots h
    where h.mint = m.mint order by ts desc limit 1
  ) l
  cross join lateral (
    select ts, holders from quote_holder_snapshots h
    where h.mint = m.mint order by ts asc limit 1
  ) e
  left join lateral (
    select ts, holders from quote_holder_snapshots h
    where h.mint = m.mint and h.ts <= now() - make_interval(hours => win_hours) order by ts desc limit 1
  ) b on true;
$$;

create or replace function quote_holder_snapshots_prune(keep_after timestamptz)
returns bigint language sql as $$
  with d as (delete from quote_holder_snapshots where ts < keep_after returning 1)
  select count(*) from d;
$$;

create table if not exists coin_census_runs (
  ts             timestamptz primary key,
  wallets        integer not null,   -- distinct owners across every covered coin
  coins          integer not null,   -- coins read
  coins_total    integer not null,   -- reward coins in the ledger at the time
  slots_covered  integer not null,   -- Σ StonkFun holderCount over covered coins
  slots_total    integer not null,   -- Σ StonkFun holderCount over every reward coin
  accounts       integer not null,   -- token accounts with a balance, before de-duplication
  coins_failed   integer not null default 0,
  first_error    text,
  duration_ms    integer
);
alter table coin_census_runs enable row level security;

create table if not exists coin_census_quotes (
  ts           timestamptz not null,
  quote_mint   text        not null,
  wallets      integer     not null,   -- distinct owners holding any covered coin quoted in this asset
  coins        integer     not null,   -- covered coins quoted in it
  coins_total  integer     not null,   -- all reward coins quoted in it
  primary key (ts, quote_mint)
);
alter table coin_census_quotes enable row level security;

-- Per run and quote-asset category (StonkFun /pairs category at run time): distinct wallets holding any
-- covered coin quoted in an asset of that category. De-duplicated within the category, so summing rows
-- across categories over-counts; the run total in coin_census_runs is the only cross-category figure.
create table if not exists coin_census_categories (
  ts        timestamptz not null,
  category  text        not null,
  wallets   integer     not null,
  coins     integer     not null,
  primary key (ts, category)
);
alter table coin_census_categories enable row level security;
