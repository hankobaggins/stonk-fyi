-- Holder-reward payout snapshots: lifetime distributed tokens per reward coin, recorded every worker
-- tick for coins that paid inside the last 7 days. Deltas over 24h / 72h give the realized holder-fee
-- APR on /yield. Compact by construction: ~50 active coins × 288 ticks/day.
create table if not exists reward_snapshots (
  mint               text not null,
  ts                 timestamptz not null,
  quote_mint         text not null,
  distributed_tokens double precision not null,
  payout_count       integer,
  holder_count       integer,
  primary key (mint, ts)
);
create index if not exists reward_snapshots_ts_idx on reward_snapshots (ts);
alter table reward_snapshots enable row level security;

-- Per coin: newest reading, and the newest reading at or before `win_hours` ago (falling back to the
-- earliest reading when history is shorter than the window; the caller checks coverage).
create or replace function reward_payout_window(win_hours integer)
returns table (mint text, quote_mint text, from_ts timestamptz, to_ts timestamptz, from_tokens double precision, to_tokens double precision)
language sql stable as $$
  with latest as (
    select distinct on (mint) mint, quote_mint, ts, distributed_tokens
    from reward_snapshots order by mint, ts desc
  ),
  base as (
    select distinct on (mint) mint, ts, distributed_tokens
    from reward_snapshots where ts <= now() - make_interval(hours => win_hours) order by mint, ts desc
  ),
  earliest as (
    select distinct on (mint) mint, ts, distributed_tokens
    from reward_snapshots order by mint, ts asc
  )
  select l.mint, l.quote_mint,
         coalesce(b.ts, e.ts), l.ts,
         coalesce(b.distributed_tokens, e.distributed_tokens), l.distributed_tokens
  from latest l
  left join base b on b.mint = l.mint
  join earliest e on e.mint = l.mint;
$$;
