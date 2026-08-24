-- ============================================================================
-- Fix: reading a team roster seq-scanned the whole athletes table.
-- ----------------------------------------------------------------------------
-- Measured before this migration: one 200-row page of a team roster took
-- 17 seconds (EXPLAIN ANALYZE, 447k shared buffers hit), which is why any
-- sizable roster read died with "canceling statement due to statement timeout".
--
-- The cause was nested RLS re-entry, not row volume:
--
--   team_roster_read  ->  EXISTS (SELECT 1 FROM teams ...)
--     teams_guardian_read  ->  EXISTS (SELECT 1 FROM ... JOIN athletes ...)
--       athletes_read  ->  can_access_athlete(id)   -- per athlete row
--
-- A policy expression that queries a table directly gets that table's own
-- policies applied inside it. So consulting `teams` for a single team_roster
-- row dragged in teams_guardian_read, whose athletes subquery then ran
-- can_access_athlete() — itself five OR'd EXISTS branches — across all 37k+
-- rows of `athletes`. Cost scaled with the size of the whole athletes table,
-- per row examined, and got worse every time test data was generated.
--
-- The rest of this schema already avoids exactly this trap by routing policy
-- predicates through SECURITY DEFINER helpers (is_team_manager, can_access_season,
-- has_account_access). 20260818120000_team_managers.sql spells out the reason:
-- "a non-definer version would re-enter those policies and recurse."
-- teams_guardian_read and team_roster_read/-_write were the two places still
-- inlining raw subqueries. This converts them to the established pattern.
--
-- Security note: each helper below keeps its predicate byte-for-byte, so the
-- set of rows each policy admits is unchanged. SECURITY DEFINER only stops the
-- *inner* tables from being re-filtered by their own policies — and in every
-- case the authorization test is the predicate itself (guardian_user_id =
-- auth.uid(), has_account_access(account_id)), never the inner RLS. If
-- anything the old form could return false negatives, since a guardian's own
-- athlete row had to survive athletes_read before the guardian check ran.
-- ============================================================================

-- A guardian may read a team when one of their own athletes is on a season
-- roster for it. Body identical to the old inline teams_guardian_read subquery.
create or replace function public.is_team_guardian(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.season_roster sr
    join public.seasons se on se.id = sr.season_id
    join public.athletes at on at.id = sr.athlete_id
    where se.team_id = t
      and at.guardian_user_id = auth.uid()
  );
$$;

drop policy if exists teams_guardian_read on public.teams;
create policy teams_guardian_read on public.teams
  for select using (public.is_team_guardian(id));

-- team_roster's own two policies had the same shape — an inline `EXISTS
-- (SELECT 1 FROM teams ...)` that re-entered every policy on teams (including
-- the guardian one above). Same predicates, routed through definer helpers.
create or replace function public.team_on_my_account(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams te
    where te.id = t and public.has_account_access(te.account_id)
  );
$$;

create or replace function public.team_writable_by_me(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams te
    where te.id = t
      and public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[])
  );
$$;

drop policy if exists team_roster_read on public.team_roster;
create policy team_roster_read on public.team_roster
  for select using (public.team_on_my_account(team_id));

drop policy if exists team_roster_write on public.team_roster;
create policy team_roster_write on public.team_roster
  for all using (public.team_writable_by_me(team_id))
  with check (public.team_writable_by_me(team_id));

-- is_team_guardian's join walks season_roster by athlete_id; athletes already
-- has idx_athletes_guardian, but season_roster had no athlete_id index of its
-- own, leaving that side of the join to a scan.
create index if not exists idx_season_roster_athlete on public.season_roster(athlete_id);

grant execute on function public.is_team_guardian(uuid) to authenticated;
grant execute on function public.team_on_my_account(uuid) to authenticated;
grant execute on function public.team_writable_by_me(uuid) to authenticated;
