-- 0017 · Views run as the querying role, not their owner (Supabase lint 0010 "security_definer_view", 2026-09-16).
-- launches_per_day and volume_by_quote_latest are convenience views from 0001 that no code reads; as owner-run
-- views in the exposed public schema they let the anon key see aggregates of tables whose RLS has no policies.
-- security_invoker makes them honour the caller's RLS (anon reads nothing; the service role is unaffected).
-- Paste into the SQL editor by hand, like every migration since 0004.
alter view public.launches_per_day set (security_invoker = on);
alter view public.volume_by_quote_latest set (security_invoker = on);
