-- Runners: one row per (token, market-cap line) the first time the token's lifetime peak market cap
-- (StonkFun's peakMarketCapUsd) is seen at or above the line. A peak only rises, so a token can cross a
-- line once and the primary key makes double counting impossible. The worker's `runners` step writes
-- rows every tick for every token it fetched (top 100 by volume + top 100 by market cap; top 500 hourly;
-- every token daily). The first run seeds every crossing that already happened (status 'seeded', no
-- reached_at) so the 24h / 7d counts start from zero and never replay history.
-- Apply by hand in the Supabase SQL editor (the GitHub integration has not applied migrations reliably).

create table if not exists mcap_milestones (
  mint            text not null,
  threshold_usd   double precision not null,      -- 1e6, 5e6, 10e6, 25e6, 50e6, 100e6
  symbol          text,
  name            text,
  quote_symbol    text,
  created_at      timestamptz,                    -- the token's launch time (StonkFun createdAt)
  ts              timestamptz not null default now(), -- when the row was written (history starts at the oldest ts)
  reached_at      timestamptz,                    -- detection tick; null for seeded rows
  after_ts        timestamptz,                    -- this site's previous snapshot of the token: the crossing lies in (after_ts, reached_at]
  mode            text,                           -- tick | hourly | full — which walk detected it
  peak_usd        double precision not null,      -- peakMarketCapUsd at detection
  market_cap_usd  double precision,               -- live market cap at detection
  status          text not null default 'crossed', -- seeded | crossed
  primary key (mint, threshold_usd)
);
create index if not exists mcap_milestones_reached_idx on mcap_milestones (reached_at desc) where reached_at is not null;

alter table mcap_milestones enable row level security;

-- Launch cohorts: tokens launched since `since` whose lifetime peak reached at least `min_peak`, from the
-- `tokens` table (raw StonkFun record, refreshed daily for every token and every tick for active ones).
-- Used by /runners for the "launched in window, by peak" view. Peak is as of the token's last read.
create or replace function runner_cohort(since timestamptz, min_peak double precision default 1000000)
returns table (mint text, symbol text, name text, quote_symbol text, created_at timestamptz, peak_usd double precision, last_seen_at timestamptz)
language sql stable security invoker as $$
  select t.mint, t.symbol, t.name, t.quote_symbol, t.created_at,
         (t.raw->'market'->>'peakMarketCapUsd')::double precision as peak_usd,
         t.last_seen_at
  from tokens t
  where t.created_at >= since
    and (t.raw->'market'->>'peakMarketCapUsd')::double precision >= min_peak
  order by peak_usd desc
  limit 2000;
$$;
