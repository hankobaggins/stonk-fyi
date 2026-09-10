-- reward_snapshots, take two (2026-09-10).
--
-- 0005 assumed ~50 reward coins pay in any 7-day window (true of the Sept-7 fixture). Live, ~5,300 do,
-- so the worker wrote 5,328 rows a tick — 1.2M rows / 333 MB in the first 21 hours — and
-- reward_payout_window() (three full DISTINCT ON sorts over the table) stopped finishing inside the
-- 8 s API statement timeout. /yield read null and showed "collecting" forever.
--
-- Now the worker only snapshots the coins /yield can display (the top YIELD_TRACKED reward coins by
-- market cap, ~200 rows a tick), and the window function takes that mint list and answers each mint
-- with three primary-key probes, so it stays fast no matter how long history grows.

-- 1. Window function: per requested mint, newest reading; newest reading at or before `win_hours`
--    ago (falling back to the earliest reading when history is shorter — the caller checks coverage).
--    Mints with no readings are omitted. Every subquery is an index probe on the (mint, ts) key.
drop function if exists reward_payout_window(integer);
create or replace function reward_payout_window(win_hours integer, mints text[])
returns table (mint text, quote_mint text, from_ts timestamptz, to_ts timestamptz, from_tokens double precision, to_tokens double precision)
language sql stable as $$
  select m.mint, l.quote_mint,
         coalesce(b.ts, e.ts), l.ts,
         coalesce(b.distributed_tokens, e.distributed_tokens), l.distributed_tokens
  from unnest(mints) as m(mint)
  cross join lateral (
    select quote_mint, ts, distributed_tokens from reward_snapshots r
    where r.mint = m.mint order by ts desc limit 1
  ) l
  cross join lateral (
    select ts, distributed_tokens from reward_snapshots r
    where r.mint = m.mint order by ts asc limit 1
  ) e
  left join lateral (
    select ts, distributed_tokens from reward_snapshots r
    where r.mint = m.mint and r.ts <= now() - make_interval(hours => win_hours) order by ts desc limit 1
  ) b on true;
$$;

-- 2. Prune: drop readings for coins no longer tracked, and anything older than `keep_after`.
--    Called by the worker's daily full run with the current tracked list. Returns rows deleted.
create or replace function reward_snapshots_prune(keep_mints text[], keep_after timestamptz)
returns bigint language sql as $$
  with d as (
    delete from reward_snapshots
    where ts < keep_after or not (mint = any (keep_mints))
    returning 1
  )
  select count(*) from d;
$$;

-- 3. One-off cleanup of the 1.2M rows 0005 accumulated: keep the 300 largest reward coins by market
--    cap as the `tokens` table last saw them (the daily full walk refreshes every coin's `raw`), so the
--    ~21 h of readings for the coins /yield will actually show survive. Runs once; harmless to re-run.
delete from reward_snapshots
where mint not in (
  select mint from tokens
  where mode = 'reward'
  order by coalesce((raw -> 'market' ->> 'marketCapUsd')::double precision, 0) desc
  limit 300
);

-- After this file: run `vacuum (analyze) reward_snapshots;` on its own (it cannot run inside the
-- editor's transaction) to give the space back, then check with
--   select count(*), count(distinct mint), pg_size_pretty(pg_total_relation_size('reward_snapshots')) from reward_snapshots;
