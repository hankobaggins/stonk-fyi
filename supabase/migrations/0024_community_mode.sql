-- 0024: StonkFun Community Mode (CLAUDE.md §6p). A Community Mode coin pays share_bps (3300 = 33%) of every holder payout
-- to holders of its QUOTE token and the rest to its own holders. StonkFun's API reports one combined distributed total per
-- coin (both legs, checked on-chain 2026-10-03), so the split is computed from the rule over the time the coin spent in
-- the mode. A coin can switch into the mode after launch (and, presumably, out), so the mode is re-read over time and
-- kept as PERIODS: a period starts at launch (start_raw 0) or when this site saw the switch (start_raw = the coin's
-- distributed total then), and ends when it saw the coin leave the mode or change its share. Raw amounts are text
-- (base units can exceed 2^53). Paste into the SQL editor by hand.

create table if not exists public.community_periods (
  id          bigint generated always as identity primary key,
  mint        text not null,
  quote_mint  text not null,
  share_bps   integer not null check (share_bps between 0 and 10000),
  start_ts    timestamptz not null,
  start_raw   text not null,                 -- distributed total (quote base units) when the period began
  start_kind  text not null check (start_kind in ('launch', 'switch')),
  end_ts      timestamptz,
  end_raw     text,
  end_kind    text check (end_kind in ('revert', 'rate')),
  created_at  timestamptz not null default now()
);
-- One open period per coin: a concurrent tick opening the same one fails instead of doubling it.
create unique index if not exists community_periods_open on public.community_periods (mint) where end_ts is null;
create index if not exists community_periods_mint on public.community_periods (mint);
create index if not exists community_periods_quote on public.community_periods (quote_mint, start_ts);

-- One row per coin that has ever been in Community Mode: what the walks last saw, and its split as of the last totals read.
create table if not exists public.community_coins (
  mint              text primary key,
  symbol            text,
  name              text,
  image_url         text,
  quote_mint        text not null,
  quote_symbol      text,
  quote_decimals    integer,
  created_at        timestamptz,
  status            text,
  market_cap_usd    double precision,
  share_bps         integer,                 -- the mode now; null = the coin has left Community Mode
  first_kind        text,                    -- 'launch' | 'switch'
  seen_at           timestamptz,
  distributed_raw   text,                    -- StonkFun's lifetime total (both legs, all modes)
  community_raw     text,                    -- the part distributed while in Community Mode
  to_quote_raw      text,                    -- of which to quote-token holders
  community_tokens  double precision not null default 0,
  to_quote_tokens   double precision not null default 0,
  to_coin_tokens    double precision not null default 0,   -- the coin holders' share of community_tokens
  to_quote_usd      double precision,        -- at the quote asset's price when last repriced
  to_coin_usd       double precision,
  payout_count      integer,
  holder_count      integer,
  last_payout_at    timestamptz,
  totals_at         timestamptz,
  priced_at         timestamptz
);
create index if not exists community_coins_quote on public.community_coins (quote_mint, to_quote_usd desc nulls last);
create index if not exists community_coins_usd on public.community_coins (to_quote_usd desc nulls last);

-- Hourly per quote asset: the cumulative quote-holder share, for per-day charts.
create table if not exists public.community_quote_snapshots (
  quote_mint      text not null,
  ts              timestamptz not null,
  quote_symbol    text,
  coins           integer not null,
  active          integer not null,          -- coins in the mode now
  to_quote_tokens double precision not null,
  to_coin_tokens  double precision not null,
  to_quote_usd    double precision,
  payouts         bigint,
  primary key (quote_mint, ts)
);
create index if not exists community_quote_snapshots_ts on public.community_quote_snapshots (ts);

-- Every reward launch since the mode went live, with its mode AT LAUNCH (never updated): launches per day, community vs plain.
create table if not exists public.reward_launches (
  mint        text primary key,
  created_at  timestamptz not null,
  quote_mint  text,
  community   boolean not null,
  share_bps   integer
);
create index if not exists reward_launches_created on public.reward_launches (created_at);

alter table public.community_periods enable row level security;
alter table public.community_coins enable row level security;
alter table public.community_quote_snapshots enable row level security;
alter table public.reward_launches enable row level security;

-- Per quote asset, over every coin that has been in the mode.
create or replace function public.community_by_quote()
returns table (quote_mint text, quote_symbol text, coins bigint, active bigint, graduated bigint, to_quote_tokens double precision,
               to_coin_tokens double precision, to_quote_usd double precision, to_coin_usd double precision, payouts bigint,
               last_payout_at timestamptz, first_at timestamptz)
language sql stable as $$
  select c.quote_mint, max(c.quote_symbol), count(*), count(*) filter (where c.share_bps is not null),
         count(*) filter (where c.status = 'graduated'), sum(c.to_quote_tokens), sum(c.to_coin_tokens),
         sum(c.to_quote_usd), sum(c.to_coin_usd), sum(coalesce(c.payout_count, 0))::bigint, max(c.last_payout_at),
         (select min(p.start_ts) from public.community_periods p where p.quote_mint = c.quote_mint)
  from public.community_coins c
  group by c.quote_mint
$$;

-- Re-value every coin's split at the given prices ({quote_mint: usd}); coins whose quote has no price keep their last USD.
create or replace function public.community_reprice(prices jsonb)
returns integer language sql volatile as $$
  with u as (
    update public.community_coins c
       set to_quote_usd = c.to_quote_tokens * (prices ->> c.quote_mint)::double precision,
           to_coin_usd  = c.to_coin_tokens  * (prices ->> c.quote_mint)::double precision,
           priced_at    = now()
     where prices ? c.quote_mint and (c.to_quote_tokens > 0 or c.to_quote_usd is not null)
     returning 1)
  select count(*)::integer from u
$$;

-- Hourly snapshot per quote asset (the worker's community step).
create or replace function public.community_snapshot(at timestamptz)
returns integer language sql volatile as $$
  with ins as (
    insert into public.community_quote_snapshots (quote_mint, ts, quote_symbol, coins, active, to_quote_tokens, to_coin_tokens, to_quote_usd, payouts)
    select quote_mint, at, max(quote_symbol), count(*), count(*) filter (where share_bps is not null),
           sum(to_quote_tokens), sum(to_coin_tokens), sum(to_quote_usd), sum(coalesce(payout_count, 0))
    from public.community_coins group by quote_mint
    on conflict (quote_mint, ts) do nothing
    returning 1)
  select count(*)::integer from ins
$$;

-- Per UTC day and quote asset: the cumulative quote-holder share at the day's last snapshot (the page differences it).
create or replace function public.community_daily(since timestamptz)
returns table (day date, quote_mint text, to_quote_tokens double precision)
language sql stable as $$
  select distinct on (s.quote_mint, (s.ts at time zone 'utc')::date)
         (s.ts at time zone 'utc')::date, s.quote_mint, s.to_quote_tokens
  from public.community_quote_snapshots s
  where s.ts >= since
  order by s.quote_mint, (s.ts at time zone 'utc')::date, s.ts desc
$$;

-- Reward launches per UTC day, and how many launched in Community Mode.
create or replace function public.reward_launch_days(since timestamptz)
returns table (day date, launches bigint, community bigint)
language sql stable as $$
  select (created_at at time zone 'utc')::date, count(*), count(*) filter (where community)
  from public.reward_launches where created_at >= since group by 1 order by 1
$$;

create or replace function public.community_snapshots_prune(keep_days integer)
returns integer language sql volatile as $$
  with d as (delete from public.community_quote_snapshots where ts < now() - make_interval(days => keep_days) returning 1)
  select count(*)::integer from d
$$;

-- The wallet rewards check stores which community quote assets a wallet held at its last scan (§6p).
alter table public.wallet_rewards add column if not exists quotes_held jsonb;
