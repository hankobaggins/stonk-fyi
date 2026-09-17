-- Runners backfill (§6k): date every crossing this site's own snapshots can date. token_snapshots holds
-- market caps since 2026-09-07 (top 100 by volume every 5 min, top 500 hourly, every token daily), so a
-- token's first snapshot at or above a line is its crossing reading, and the snapshot before it the lower
-- bound — the same (after_ts, reached_at] shape the live worker writes. A token whose very first snapshot
-- is already above the line is 'seeded' (crossed before we looked) unless it launched within 36 h of that
-- reading, in which case the crossing lies in (created_at, reached_at]. STONK itself is excluded.
-- Idempotent: rows the worker already seeded are upgraded to 'crossed' when the snapshots can date them;
-- existing 'crossed' rows are never touched. Apply by hand in the SQL editor, before or after 0018's first
-- tick (0018 must exist). Takes a few seconds; on a slow day run it twice, it converges.

with cand as (
  select distinct s.mint
  from token_snapshots s
  where s.market_cap_usd >= 1000000
    and s.mint <> '6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx'
),
snaps as (
  select s.mint, s.ts, s.market_cap_usd,
         lag(s.ts) over (partition by s.mint order by s.ts) as prev_ts
  from token_snapshots s
  join cand using (mint)
  where s.market_cap_usd is not null
),
firsts as (
  select l.line, sn.mint, min(sn.ts) as reached_at
  from unnest(array[1e6, 5e6, 1e7, 2.5e7, 5e7, 1e8]::double precision[]) as l(line)
  join snaps sn on sn.market_cap_usd >= l.line
  group by l.line, sn.mint
),
rows_ as (
  select f.mint, f.line as threshold_usd, f.reached_at, sn.prev_ts, sn.market_cap_usd,
         t.symbol, t.name, t.quote_symbol, t.created_at,
         greatest(coalesce((t.raw->'market'->>'peakMarketCapUsd')::double precision, 0), sn.market_cap_usd) as peak_usd,
         (sn.prev_ts is not null or (t.created_at is not null and t.created_at >= f.reached_at - interval '36 hours')) as crossed
  from firsts f
  join snaps sn on sn.mint = f.mint and sn.ts = f.reached_at
  join tokens t on t.mint = f.mint
),
ins as (
  insert into mcap_milestones (mint, threshold_usd, symbol, name, quote_symbol, created_at, ts, reached_at, after_ts, mode, peak_usd, market_cap_usd, status)
  select r.mint, r.threshold_usd, r.symbol, r.name, r.quote_symbol, r.created_at,
         r.reached_at,
         case when r.crossed then r.reached_at end,
         case when r.crossed then coalesce(r.prev_ts, r.created_at) end,
         'backfill', r.peak_usd, r.market_cap_usd,
         case when r.crossed then 'crossed' else 'seeded' end
  from rows_ r
  on conflict (mint, threshold_usd) do update
    set reached_at = excluded.reached_at, after_ts = excluded.after_ts, mode = excluded.mode, ts = excluded.ts,
        market_cap_usd = excluded.market_cap_usd, status = excluded.status
    where mcap_milestones.status = 'seeded' and excluded.status = 'crossed'
  returning status, threshold_usd
)
select status, threshold_usd, count(*) from ins group by 1, 2 order by 2, 1;
