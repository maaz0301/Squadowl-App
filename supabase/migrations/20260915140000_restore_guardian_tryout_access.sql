-- Regression fix: guardians lost access to their own athlete's tryouts.
--
-- 0006_guardian_roster_access.sql added a branch to can_access_tryout() so a
-- guardian could read a tryout their athlete is a participant in. When
-- 20260818150000_team_manager_assessment_access.sql widened the same function
-- for delegated team managers, it redefined can_access_tryout() from scratch
-- and dropped that guardian branch — leaving only the four branches later
-- documented in 20260826150000 (account staff, assessor, team manager, team's
-- account staff). Every table that gates on can_access_tryout() (evaluations,
-- evaluation_scores, tryout_participants, tryout_assessors, registrations,
-- Team Builder results) and get_guardian_rosters() (20260817130000) itself
-- inherited the loss silently: a guardian's "My Athletes" would show the
-- athlete's card only if they also had an active season, and any athlete with
-- only a tryout/evaluation vanished from the list entirely.
--
-- Restore the guardian branch alongside the team-manager branches — a pure
-- superset of both prior definitions.
create or replace function public.can_access_tryout(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tryouts ty where ty.id = t and (
      public.has_account_role(ty.account_id, array['owner','admin','coach']::membership_role[])
      or exists (select 1 from public.tryout_assessors ta
                 where ta.tryout_id = t and ta.user_id = auth.uid())
      or exists (select 1 from public.tryout_participants tp
                 join public.athletes a on a.id = tp.athlete_id
                 where tp.tryout_id = t and a.guardian_user_id = auth.uid())
      or (ty.team_id is not null and public.is_team_manager(ty.team_id))
      or (ty.team_id is not null and exists (
            select 1 from public.teams te where te.id = ty.team_id
              and public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[])
          ))
    )
  );
$$;
