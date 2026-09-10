-- All-time-high alerts: one row per new STONK market-cap high seen by the worker's ath_alert step.
-- The first run seeds StonkFun's peakMarketCapUsd (status 'seeded', nothing posted), so the feature never
-- announces a high that was already set. Every later high is recorded; only highs outside the posting
-- cooldown are tweeted (status 'posted'), the rest are 'quiet'. The unique index on market_cap_usd makes a
-- concurrent tick's insert fail instead of double-posting the same figure.
-- Apply by hand in the Supabase SQL editor (the GitHub integration has not applied migrations reliably).

create table if not exists ath_alerts (
  id                bigint generated always as identity primary key,
  ts                timestamptz not null default now(),   -- detection time (the tick that saw it)
  market_cap_usd    double precision not null,            -- the new high (StonkFun pricing)
  source            text not null,                        -- live-mcap | stonkfun-peak
  prev_high_usd     double precision,                     -- highest figure in the ledger before this row
  prev_high_at      timestamptz,
  gain_pct          double precision,                     -- vs prev_high_usd
  price_usd         double precision,
  price_change_24h  double precision,
  launch_mcap_usd   double precision,
  supply_burned_pct double precision,
  card_url          text,
  post_text         text,
  socialbu_post_id  text,
  status            text not null default 'pending',      -- seeded | quiet | pending | posted | dry_run | failed
  error             text
);
create unique index if not exists ath_alerts_mcap_key on ath_alerts (market_cap_usd);
create index if not exists ath_alerts_ts_idx on ath_alerts (ts desc);

alter table ath_alerts enable row level security;
