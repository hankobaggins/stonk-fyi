-- StonkFun metrics: time-series schema for the snapshot worker.
-- Run in the Supabase SQL editor or via `supabase db push`.

create table if not exists platform_snapshots (
  ts                    timestamptz primary key default now(),
  tokens_total          int,
  tokens_graduated      int,
  tokens_about_to_grad  int,
  reward_launches       int,
  total_market_cap_usd  double precision,
  total_volume_24h_usd  double precision,
  total_revenue_usd     double precision,
  total_buyback_usd     double precision,
  bought_back_tokens    double precision,
  buyback_count         int,
  burn_value_usd        double precision,
  burn_count            int,
  raw                   jsonb
);

create table if not exists tokens (
  mint            text primary key,
  pool            text,
  name            text,
  symbol          text,
  quote_mint      text,
  quote_symbol    text,
  quote_category  text,
  creator         text,
  launchpad       text,
  mode            text,
  transfer_fee_bps int,
  image_url       text,
  status          text,
  created_at      timestamptz,
  graduated_at    timestamptz,
  first_seen_at   timestamptz default now(),
  last_seen_at    timestamptz default now(),
  raw             jsonb
);
create index if not exists tokens_quote_mint_idx on tokens (quote_mint);
create index if not exists tokens_status_idx on tokens (status);
create index if not exists tokens_created_at_idx on tokens (created_at desc);

-- One row per token per snapshot tick. This is the big table; the worker only
-- snapshots "active" tokens (nonzero 24h volume) at high frequency.
create table if not exists token_snapshots (
  mint              text not null references tokens (mint),
  ts                timestamptz not null,
  price_usd         double precision,
  market_cap_usd    double precision,
  volume_24h_usd    double precision,
  liquidity_usd     double precision,
  price_change_24h  double precision,
  status            text,
  graduation_progress double precision,
  primary key (mint, ts)
);
create index if not exists token_snapshots_ts_idx on token_snapshots (ts desc);

create table if not exists buybacks (
  signature         text primary key,
  burn_signature    text,
  quote_mint        text,
  quote_symbol      text,
  spent_tokens      double precision,
  spent_value_usd   double precision,
  bought_tokens     double precision,
  bought_value_usd  double precision,
  bought_at         timestamptz not null
);
create index if not exists buybacks_bought_at_idx on buybacks (bought_at desc);

create table if not exists launches (
  mint            text primary key,
  pool            text,
  name            text,
  symbol          text,
  creator         text,
  quote_mint      text,
  quote_symbol    text,
  launchpad       text,
  mode            text,
  transfer_fee_bps int,
  start_mcap_usd  double precision,
  created_at      timestamptz not null
);
create index if not exists launches_created_at_idx on launches (created_at desc);

create table if not exists revenue_daily (
  day                     date primary key,
  revenue_usd             double precision,
  holders_revenue_usd     double precision,
  protocol_revenue_usd    double precision,
  updated_at              timestamptz default now()
);

-- Convenience views -----------------------------------------------------------

create or replace view launches_per_day as
  select date_trunc('day', created_at)::date as day, count(*) as launches,
         count(*) filter (where mode = 'reward') as reward_launches
  from launches group by 1 order by 1;

create or replace view volume_by_quote_latest as
  with latest as (select max(ts) as ts from token_snapshots)
  select t.quote_symbol, t.quote_category,
         count(*) as tokens,
         sum(s.volume_24h_usd) as volume_24h_usd,
         sum(s.market_cap_usd) as market_cap_usd
  from token_snapshots s join tokens t using (mint), latest
  where s.ts = latest.ts
  group by 1, 2 order by 4 desc;

-- Per-burn ledger for STONK (and any other mint the worker is pointed at).
create table if not exists token_burns (
  signature         text primary key,
  mint              text not null,
  amount_tokens     double precision,
  value_usd_at_burn double precision,
  source            text,
  burned_at         timestamptz not null
);
create index if not exists token_burns_mint_burned_at_idx on token_burns (mint, burned_at desc);

create or replace view stonk_burns_daily as
  select date_trunc('day', burned_at)::date as day,
         sum(amount_tokens) as tokens_burned,
         sum(value_usd_at_burn) as usd_at_burn,
         count(*) as burns
  from token_burns
  where mint = '6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx'
  group by 1 order by 1;

-- STONK/SPYx pool reserves per tick (from Raydium's pool-info API). Reserve deltas = net flow through the pool.
create table if not exists pool_snapshots (
  pool_id           text not null,
  ts                timestamptz not null,
  stonk_reserve     double precision,
  quote_reserve     double precision,
  quote_symbol      text,
  price_quote       double precision,   -- STONK per quote unit
  tvl_usd           double precision,
  volume_24h_usd    double precision,
  primary key (pool_id, ts)
);
