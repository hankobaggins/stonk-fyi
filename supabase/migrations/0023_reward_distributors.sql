-- 0023: wallet rewards check, distributor tracking (CLAUDE.md §6o, 2026-10-01). Paste into the SQL editor by hand.
--
-- reward_distributors: every wallet seen paying StonkFun holder rewards. Seeded with the two verified on-chain on
-- 2026-10-01 (5KXDF6… paid holders directly until 2026-09-20 05:03 UTC; HuBMe… since, funded by 5KXDF6…); the worker's
-- `reward_distributors` step adds any new payer of StonkFun's own latest distributions, hourly.
-- wallet_rewards gains: dist_key (the distributor set + rule version a row was built with — a row built with another is
-- re-read from the start on its next lookup), unexplained (plain transfers into the wallet from non-distributors, by
-- source, top 20: /api/health sums them to spot a payer this site does not know), by_distributor (payouts by payer).

create table if not exists public.reward_distributors (
  address     text primary key,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  seen        integer not null default 0,
  source      text,
  sample_sig  text,
  note        text
);
alter table public.reward_distributors enable row level security;

insert into public.reward_distributors (address, source, note) values
  ('5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD', 'seed 2026-10-01', 'StonkFun operations wallet; paid holders directly until 2026-09-20 05:03 UTC'),
  ('HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga', 'seed 2026-10-01', 'payout wallet funded by 5KXDF6; pays holders since 2026-09-20 05:03 UTC')
on conflict (address) do nothing;

alter table public.wallet_rewards add column if not exists dist_key text;
alter table public.wallet_rewards add column if not exists unexplained jsonb not null default '{}'::jsonb;
alter table public.wallet_rewards add column if not exists by_distributor jsonb not null default '{}'::jsonb;
