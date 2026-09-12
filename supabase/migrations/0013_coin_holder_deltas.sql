-- 0013: HolderScan's 7 / 14 / 30-day holder-count deltas per reward coin (2026-09-12). The only
-- backdated view of "holders added to StonkFun coins": summed over the largest coins by holder count
-- it gives holder-slots added over each window (a wallet holding two coins counts twice — the
-- de-duplicated figure only exists from the first census onwards). Worker step `coin_deltas`.
create table if not exists coin_holder_deltas (
  mint         text        not null,
  ts           timestamptz not null,
  quote_mint   text        not null,
  holders_now  integer     not null,   -- StonkFun holderCount at the time of the read
  d7           integer,
  d14          integer,
  d30          integer,
  primary key (mint, ts)
);
alter table coin_holder_deltas enable row level security;
