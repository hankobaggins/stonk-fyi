-- Launch velocity from the launch ledger, not the token index (2026-09-18).
-- StonkFun's /stats tokens.total fell from 74,621 to 8,271 at 17:45 UTC on 2026-09-18 (the
-- launchlab tokens left their index) and the launches-per-hour figure read 0 for a day. The
-- /launches pagination total kept counting, so the worker now stores it and getLaunchVelocity
-- reads it first, with tokens_total as the fallback for rows written before this column existed.
-- Paste into the SQL editor by hand (the GitHub integration does not apply migrations reliably).
alter table platform_snapshots add column if not exists launches_total int;
