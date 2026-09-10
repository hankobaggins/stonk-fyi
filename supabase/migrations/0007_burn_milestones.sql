-- Burn milestones: one row per whole percent of STONK supply burned (13, 14, ...). The worker's
-- burn_milestone step posts a card to X when a new whole percent is crossed. The first run seeds the
-- current level (status 'seeded', nothing posted) so the feature never announces old milestones.
-- Apply by hand in the Supabase SQL editor (the GitHub integration has not applied migrations reliably).

create table if not exists burn_milestones (
  pct               integer primary key,        -- the whole percent reached (13 = 13% of 1B burned)
  ts                timestamptz not null default now(),
  reached_at        timestamptz,                -- burn that crossed the line, when it is inside the API's recent window; null when seeded
  crossing_signature text,
  burned_tokens     double precision not null,  -- lifetime total at detection
  burned_value_usd  double precision,           -- lifetime USD at burn (StonkFun pricing)
  burn_count        integer,
  supply_burned_pct double precision not null,  -- exact % at detection (e.g. 13.02)
  velocity_pct_day  double precision,
  velocity_signal   text,                       -- bull | neutral | bear | info
  price_usd         double precision,
  market_cap_usd    double precision,
  prev_reached_at   timestamptz,                -- reached_at of the previous milestone row (for "the last 1% took N days")
  card_url          text,
  post_text         text,
  socialbu_post_id  text,
  status            text not null default 'pending',  -- seeded | pending | posted | dry_run | failed | skipped
  error             text
);

alter table burn_milestones enable row level security;
