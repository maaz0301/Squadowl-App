-- ============================================================================
-- CLUB mode delegation, part 3: the delegated team's plan features travel too
-- ----------------------------------------------------------------------------
-- Every plan-gated feature in the client (exports, AI summaries, Team Builder,
-- custom rubrics, fee collection) reads the *caller's own* account plan_tier.
-- For a delegated team that's wrong: the team belongs to a Club-tier account,
-- but the coach it was handed to might personally be on Free. They'd see the
-- team's roster and schedule (already delegated) but hit upgrade paywalls on
-- every feature the club already pays for.
--
-- This doesn't touch RLS — reads/writes are already delegated. It only adds a
-- narrow lookup the client needs to know *which* tier to gate against: the
-- owning account's plan_tier for each team delegated to the caller. Scoped to
-- exactly the caller's own managed teams (not a general "read anyone's plan
-- tier" hole) via the same team_managers join every other function here uses.
-- ============================================================================

create or replace function public.list_managed_team_owner_tiers()
returns table (team_id uuid, plan_tier text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id as team_id, a.plan_tier::text as plan_tier
  from public.teams t
  join public.team_managers tm on tm.team_id = t.id
  join public.accounts a on a.id = t.account_id
  where tm.user_id = auth.uid();
$$;

grant execute on function public.list_managed_team_owner_tiers() to authenticated;
