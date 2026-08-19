-- ============================================================================
-- CLUB mode delegation, part 2: assessments and RSVPs travel with the team
-- ----------------------------------------------------------------------------
-- 20260818120000_team_managers.sql gave a delegated manager the team's roster,
-- schedule, and chat by widening can_access_season / can_access_athlete. It
-- never touched tryouts (assessments/evaluations/scores) or the RSVP
-- (event_availability) write path, so a manager could see the schedule but not
-- the "Assessments" tab's contents, and couldn't record an RSVP on a team
-- member's behalf. This closes both gaps the same way: widen the shared
-- predicate rather than adding a policy per table, so every table that already
-- gates on can_access_tryout / can_manage_tryout (evaluations, scores,
-- participants, assessors, registrations, Team Builder results) picks this up
-- for free.
--
-- A tryout linked to a team (tryouts.team_id) can end up with an account_id
-- that ISN'T the club's own account: a delegate creating a new assessment from
-- the team hub inserts it under their own account (createTryout always does),
-- while still attaching it to the club's team. Both widened predicates below
-- therefore check team ownership in both directions — the delegate reaching a
-- club-owned tryout, and club staff reaching a tryout a delegate created under
-- their own account but linked to the club's team — so neither side loses
-- visibility depending on who happened to create the row.
-- ============================================================================

create or replace function public.can_access_tryout(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tryouts ty where ty.id = t and (
      public.has_account_role(ty.account_id, array['owner','admin','coach']::membership_role[])
      or exists (select 1 from public.tryout_assessors ta
                 where ta.tryout_id = t and ta.user_id = auth.uid())
      or (ty.team_id is not null and public.is_team_manager(ty.team_id))
      or (ty.team_id is not null and exists (
            select 1 from public.teams te where te.id = ty.team_id
              and public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[])
          ))
    )
  );
$$;

create or replace function public.can_manage_tryout(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tryouts ty where ty.id = t
      and (
        public.has_account_role(ty.account_id, array['owner','admin','coach']::membership_role[])
        or (ty.team_id is not null and public.is_team_manager(ty.team_id))
        or (ty.team_id is not null and exists (
              select 1 from public.teams te where te.id = ty.team_id
                and public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[])
            ))
      )
  );
$$;

-- tryouts itself: tryouts_write (0001) only checks has_account_role(account_id),
-- so it doesn't inherit the can_manage_tryout widening above. Add the same
-- team-ownership branches directly, scoped to team-linked rows only — an
-- unlinked tryout is unaffected.
drop policy if exists tryouts_manager_write on public.tryouts;
create policy tryouts_manager_write on public.tryouts
  for all using (
    team_id is not null and (
      public.is_team_manager(team_id)
      or exists (select 1 from public.teams te where te.id = team_id
                 and public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[]))
    )
  )
  with check (
    team_id is not null and (
      public.is_team_manager(team_id)
      or exists (select 1 from public.teams te where te.id = team_id
                 and public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[]))
    )
  );

-- RSVPs (event_availability): availability_read already flows through the
-- can_access_season widening from part 1. availability_write checks
-- has_account_role directly though, so a manager could see RSVPs but not
-- record one on a player's behalf (the coach-side override, distinct from a
-- guardian setting their own athlete's response, which is the other branch).
drop policy if exists availability_write on public.event_availability;
create policy availability_write on public.event_availability
  for all using (
    exists (select 1 from public.season_roster sr join public.athletes at on at.id = sr.athlete_id
            where sr.id = roster_id and at.guardian_user_id = auth.uid())
    or exists (select 1 from public.season_events ev join public.seasons se on se.id = ev.season_id
               where ev.id = season_event_id
               and (
                 public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
                 or (se.team_id is not null and public.is_team_manager(se.team_id))
               ))
  )
  with check (true);

-- ----------------------------------------------------------------------------
-- Client-side listing: listTryouts() filters by the caller's own account_id
-- before RLS is even reached, so a delegate would never fetch a club-owned
-- tryout even though the widened policies above now let them read it. Mirrors
-- list_teams_managed_by_me from part 1.
-- ----------------------------------------------------------------------------
create or replace function public.list_tryouts_for_managed_teams()
returns setof public.tryouts
language sql
stable
security definer
set search_path = public
as $$
  select ty.*
  from public.tryouts ty
  join public.team_managers tm on tm.team_id = ty.team_id
  where tm.user_id = auth.uid()
    and ty.deleted_at is null
  order by ty.created_at desc;
$$;

grant execute on function public.list_tryouts_for_managed_teams() to authenticated;
