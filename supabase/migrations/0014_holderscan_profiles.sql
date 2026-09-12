-- 0014: HolderScan holder profiles (2026-09-12, CLAUDE.md §6h). Paste into the SQL editor by hand.
--
-- holderscan_snapshots   one HolderScan profile per tracked mint per worker read: holder count and HolderScan's
--                        own deltas, holders by USD tier and size tier, concentration (HHI / Gini / top-10 share),
--                        median position, hold time, retention, aggregate PnL, hold-time classes of the top 1000.
--                        STONK every tick on the Advanced plan (~288 rows a day, ~100 KB), every 6 h on Standard.
--                        Keyed by mint so other tokens can be profiled later. Pruned to HOLDERSCAN_RETENTION_DAYS.
-- quote_holder_deltas / coin_holder_deltas   + d1 / d3: HolderScan's 1-day and 3-day changes (the route grew
--                        1h…3d windows), so the 24h column on /holders can be backfilled like 7d / 30d.
-- holder_snapshots       holder_window() now compares readings of the same source as the newest one, so the
--                        hourly stock-quoted block can move from GMGN to HolderScan without a spurious step.

create table if not exists holderscan_snapshots (
  mint               text        not null,
  ts                 timestamptz not null,
  holders            integer     not null,
  price_usd          double precision,   -- StonkFun price at read time (for the USD figures derived on the page)
  market_cap_usd     double precision,
  d1h                integer, d4h integer, d12h integer, d1 integer, d3 integer, d7 integer, d14 integer, d30 integer,
  over_10            integer, over_100 integer, over_1k integer, over_10k integer, over_100k integer, over_1m integer,
  shrimp             integer, crab integer, fish integer, dolphin integer, whale integer,
  hhi                double precision,
  gini               double precision,
  median_position    double precision,   -- whole tokens
  avg_time_held_sec  double precision,
  retention_rate     double precision,
  break_even_price   double precision,
  realized_pnl_usd   double precision,
  unrealized_pnl_usd double precision,
  wc_diamond         integer, wc_gold integer, wc_silver integer, wc_bronze integer, wc_wood integer, wc_new integer,
  sb_diamond         double precision, sb_gold double precision, sb_silver double precision, sb_bronze double precision, sb_wood double precision,
  top10_share        double precision,   -- Σ top-10 amounts ÷ circulating supply (0..1); pools included
  top100_share       double precision,
  errors             text,               -- routes that did not answer this read, if any
  primary key (mint, ts)
);
alter table holderscan_snapshots enable row level security;

create or replace function holderscan_snapshots_prune(keep_after timestamptz)
returns bigint language sql as $$
  with d as (delete from holderscan_snapshots where ts < keep_after returning 1)
  select count(*) from d;
$$;

alter table quote_holder_deltas add column if not exists d1 integer;
alter table quote_holder_deltas add column if not exists d3 integer;
alter table coin_holder_deltas  add column if not exists d1 integer;
alter table coin_holder_deltas  add column if not exists d3 integer;

-- Same shape as 0009's holder_window, restricted to the source of the newest reading per mint.
create or replace function holder_window(win_hours integer, mints text[])
returns table (mint text, from_ts timestamptz, to_ts timestamptz, from_holders integer, to_holders integer)
language sql stable as $$
  select m.mint,
         coalesce(b.ts, e.ts), l.ts,
         coalesce(b.holders, e.holders), l.holders
  from unnest(mints) as m(mint)
  cross join lateral (
    select ts, holders, source from holder_snapshots h
    where h.mint = m.mint order by ts desc limit 1
  ) l
  cross join lateral (
    select ts, holders from holder_snapshots h
    where h.mint = m.mint and h.source = l.source order by ts asc limit 1
  ) e
  left join lateral (
    select ts, holders from holder_snapshots h
    where h.mint = m.mint and h.source = l.source and h.ts <= now() - make_interval(hours => win_hours) order by ts desc limit 1
  ) b on true;
$$;

-- Hourly series for the charts: one bucket per hour (newest reading in the bucket), oldest first.
create or replace function holderscan_series(p_mint text, since timestamptz)
returns table (ts timestamptz, holders integer, over_1k integer, over_10k integer, market_cap_usd double precision)
language sql stable as $$
  select distinct on (date_trunc('hour', h.ts)) h.ts, h.holders, h.over_1k, h.over_10k, h.market_cap_usd
  from holderscan_snapshots h
  where h.mint = p_mint and h.ts >= since
  order by date_trunc('hour', h.ts), h.ts desc;
$$;
