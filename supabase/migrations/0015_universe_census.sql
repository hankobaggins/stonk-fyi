-- 0015: the quote-asset census covers the whole universe (2026-09-13, CLAUDE.md §6g). Paste by hand.
-- wallet_mint_counts now holds every universe quote asset (not only the stock-quoted ones); a mint whose
-- token accounts exceed the per-mint page cap is stored with what was read and flagged truncated.
alter table wallet_mint_counts add column if not exists truncated boolean not null default false;
