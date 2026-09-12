-- 0012: HolderScan's own 7 / 14 / 30-day holder-count deltas per universe quote asset (2026-09-12).
-- Lets the 7d and 30d columns on /holders show from day one, from HolderScan's history, until this
-- site's own daily readings (quote_holder_snapshots, 0011) cover the window. Worker step
-- `universe_deltas`, every third day on the 02:15 UTC tick (20 request units a call, ~6.3K a run).
create table if not exists quote_holder_deltas (
  mint  text        not null,
  ts    timestamptz not null,
  d7    integer,
  d14   integer,
  d30   integer,
  primary key (mint, ts)
);
alter table quote_holder_deltas enable row level security;
