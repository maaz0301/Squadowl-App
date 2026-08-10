-- TryoutHQ pricing v2: add 'coach_plus' tier and retire 'pro'/'association' as sellable tiers.
-- Enum values are never dropped (Postgres doesn't support it cleanly), so 'pro' and
-- 'association' remain valid historically, but any account currently on one of them is
-- migrated to 'club', which now has equal-or-greater limits and features.

alter type plan_tier add value if not exists 'coach_plus';

update public.accounts
set plan_tier = 'club'
where plan_tier in ('pro', 'association');
