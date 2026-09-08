-- 0004: run the 5-minute snapshot tick from inside Supabase (pg_cron + pg_net).
--
-- Why: GitHub Actions' `schedule:` trigger is throttled on quiet repos — in production it fired
-- every ~4 h instead of every 5 min (9 runs in the first 24 h), so platform_snapshots stalled and
-- every DB-backed chart (hourly fee revenue, launch velocity, net flow) froze between runs.
--
-- How: pg_cron calls https://stonk.fyi/api/cron/snapshot through pg_net. The bearer secret is read
-- from Supabase Vault at run time, so this file carries no secret. Vercel's daily ?full=1 cron and
-- the GitHub workflow (now a manual fallback) are unchanged.
--
-- BEFORE running this file in the SQL editor, store the secret once (same value as CRON_SECRET on
-- Vercel). This line is deliberately not part of the migration:
--
--   select vault.create_secret('<CRON_SECRET value>', 'cron_secret', 'bearer for stonk.fyi/api/cron/snapshot');
--
-- To rotate: update vault.secrets where name = 'cron_secret' via vault.update_secret(id, new_secret).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One function so the two jobs share the request code. security definer + fixed search_path so the
-- cron runner can read the vault regardless of who owns the job.
create or replace function public.snapshot_tick(mode text default '')
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  secret text;
  url text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if secret is null then
    raise exception 'vault secret cron_secret not set';
  end if;
  url := 'https://stonk.fyi/api/cron/snapshot' || case when mode = '' then '' else '?' || mode end;
  -- pg_net is async: this returns a request id immediately; the response lands in net._http_response.
  -- Timeout covers the worker's maxDuration (300 s) so a slow hourly walk is never cut off.
  return net.http_get(
    url := url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'User-Agent', 'stonk-fyi-pg_cron'),
    timeout_milliseconds := 295000
  );
end;
$$;

revoke all on function public.snapshot_tick(text) from public, anon, authenticated;

-- Idempotent: drop any earlier versions of the jobs before scheduling.
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname in ('snapshot_tick', 'snapshot_hourly') loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

-- Minutes 5..55: normal tick (STONK + top 100 by volume).
select cron.schedule('snapshot_tick', '5-59/5 * * * *', $$select public.snapshot_tick()$$);
-- Minute 0: the wider hourly snapshot (top 500). Mirrors the old workflow's "minute < 5" branch.
select cron.schedule('snapshot_hourly', '0 * * * *', $$select public.snapshot_tick('hourly=1')$$);

-- Keep cron's own log from growing forever (free tier).
select cron.schedule('cron_log_prune', '17 4 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

-- Verify:
--   select jobid, jobname, schedule, active from cron.job;
--   select jobname, status, return_message, start_time from cron.job_run_details d join cron.job using (jobid) order by start_time desc limit 10;
--   select id, status_code, created, left(content::text, 200) from net._http_response order by created desc limit 5;
--   select ts from platform_snapshots order by ts desc limit 3;   -- expect a new row every 5 min
