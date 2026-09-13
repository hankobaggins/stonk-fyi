-- Burn-velocity alerts: one row per state transition of the scorecard's burn-velocity indicator (rolling 4h
-- burn rate as % of supply per day). `hot` = crossed above the bullish line (0.3%/day) from a re-armed state,
-- `cool` = fell back below the re-arm level (0.2%/day). Only hot rows post to X (status posted / dry_run;
-- `quiet` when inside the posting cooldown). The first run seeds the current state and posts nothing.
-- prev_id is the row this one followed: the unique index makes a concurrent tick that read the same last
-- row fail on insert instead of double-posting.
-- Apply by hand in the Supabase SQL editor (the GitHub integration has not applied migrations reliably).

create table if not exists velocity_alerts (
  id                bigint generated always as identity primary key,
  ts                timestamptz not null default now(),   -- detection time (the tick that saw it)
  state             text not null,                        -- hot | cool
  pct_day           double precision not null,            -- burn velocity at this reading, % of supply / day
  threshold_pct     double precision not null,
  rearm_pct         double precision not null,
  prev_id           bigint references velocity_alerts (id),
  prev_pct_day      double precision,                     -- the previous transition's reading ("up from …")
  prev_ts           timestamptz,
  window_hours      double precision,
  window_tokens     double precision,                     -- burned inside the window
  window_usd        double precision,                     -- at StonkFun's value-at-burn
  window_burns      integer,
  tokens_per_hour   double precision,
  supply_burned_pct double precision,
  price_usd         double precision,
  market_cap_usd    double precision,
  card_url          text,
  post_text         text,
  socialbu_post_id  text,
  status            text not null default 'pending',      -- seeded | cooled | quiet | pending | posted | dry_run | failed
  error             text
);
create unique index if not exists velocity_alerts_prev_key on velocity_alerts (prev_id);
create index if not exists velocity_alerts_ts_idx on velocity_alerts (ts desc);

alter table velocity_alerts enable row level security;
