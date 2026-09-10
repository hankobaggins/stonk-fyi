-- 0009: unique-holder counts for stock-quoted assets (2026-09-10). Feeds /holders.
--
-- Two kinds of mint are tracked, one reading per mint per hourly worker run (§6e in CLAUDE.md):
--   quote  the quote assets StonkFun tags xstock / prestock / tessera / backpack (~80 mints);
--          holder count from GMGN token info (holder_count), one call per mint.
--   coin   the HOLDERS_TRACKED largest reward-mode coins by market cap quoted in those assets;
--          holder count is StonkFun's own holderCount from /rewards (one call for all of them).
-- ~180 rows an hour, pruned to HOLDERS_RETENTION_DAYS (14) by the daily full run, so the table
-- stays around 60K rows. Sized from the live endpoints, not a fixture (see the 0005 post-mortem).

create table if not exists holder_snapshots (
  mint        text        not null,
  ts          timestamptz not null,
  kind        text        not null,           -- 'quote' | 'coin'
  quote_mint  text,                           -- coins: the quote asset they trade in
  holders     integer     not null,
  source      text        not null,           -- 'gmgn' | 'stonkfun'
  primary key (mint, ts)
);
alter table holder_snapshots enable row level security;

-- Per requested mint: newest reading; the newest reading at or before `win_hours` ago (falling back
-- to the earliest reading when history is shorter — the caller checks coverage). Three primary-key
-- probes per mint, same shape as reward_payout_window (0006), so it stays fast at any table size.
create or replace function holder_window(win_hours integer, mints text[])
returns table (mint text, from_ts timestamptz, to_ts timestamptz, from_holders integer, to_holders integer)
language sql stable as $$
  select m.mint,
         coalesce(b.ts, e.ts), l.ts,
         coalesce(b.holders, e.holders), l.holders
  from unnest(mints) as m(mint)
  cross join lateral (
    select ts, holders from holder_snapshots h
    where h.mint = m.mint order by ts desc limit 1
  ) l
  cross join lateral (
    select ts, holders from holder_snapshots h
    where h.mint = m.mint order by ts asc limit 1
  ) e
  left join lateral (
    select ts, holders from holder_snapshots h
    where h.mint = m.mint and h.ts <= now() - make_interval(hours => win_hours) order by ts desc limit 1
  ) b on true;
$$;

-- Prune: readings for mints no longer tracked, and anything older than `keep_after`. Returns rows deleted.
create or replace function holder_snapshots_prune(keep_mints text[], keep_after timestamptz)
returns bigint language sql as $$
  with d as (
    delete from holder_snapshots
    where ts < keep_after or not (mint = any (keep_mints))
    returning 1
  )
  select count(*) from d;
$$;
