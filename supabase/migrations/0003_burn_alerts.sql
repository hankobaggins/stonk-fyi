-- Big-burn alerts: one row per posted (or dry-run) alert, plus the burn signatures it covered so
-- overlapping 10-minute windows never announce the same burn twice.

create table if not exists burn_alerts (
  id              bigint generated always as identity primary key,
  ts              timestamptz not null default now(),
  window_start    timestamptz not null,
  window_end      timestamptz not null,
  amount_tokens   double precision not null,
  value_usd       double precision,
  burn_count      integer not null,
  sources         jsonb,               -- { buyback: n, flywheel: n, ... }
  supply_burned_pct double precision,  -- total supply burned after this window
  velocity_pct_day  double precision,  -- burn-velocity indicator at post time
  velocity_signal   text,              -- bull | neutral | bear | info
  price_usd       double precision,
  largest_signature text,
  card_url        text,
  post_text       text,
  socialbu_post_id text,
  status          text not null default 'pending',  -- pending | posted | dry_run | failed
  error           text
);
create index if not exists burn_alerts_ts_idx on burn_alerts (ts desc);

create table if not exists burn_alert_signatures (
  signature   text primary key,   -- no FK: the alert step must not depend on the stonk_burns step succeeding
  alert_id    bigint not null references burn_alerts (id) on delete cascade
);

alter table burn_alerts            enable row level security;
alter table burn_alert_signatures  enable row level security;
