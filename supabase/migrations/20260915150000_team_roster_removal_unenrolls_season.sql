-- Removing a player from the team roster doesn't remove them from the guardian's view.
--
-- 20260902130000_team_roster_season_enrollment.sql made "on the team roster"
-- imply "on the team's season" with an AFTER INSERT trigger, because the
-- guardian portal reads season_roster, not team_roster. It only covered the
-- insert side: removeTeamRosterPlayer() (SupabaseDataSource.ts) deletes the
-- team_roster row alone, so a player the coach removes from the team stays on
-- season_roster forever — their guardian keeps seeing the team, its schedule,
-- RSVPs and fees for a roster spot that no longer exists on the coach's side.
--
-- Mirror the insert trigger with the delete-side equivalent: drop the athlete
-- from every one of the team's *active* seasons (archived ones are already
-- gone from every coach- and guardian-facing screen, so leave those rows —
-- and the fee/attendance history on them — alone). event_availability rows
-- cascade off season_roster's own FK (0001_initial_schema.sql), so no manual
-- cleanup is needed there.
create or replace function public.unenroll_athlete_from_team_seasons()
returns trigger
language plpgsql
-- SECURITY DEFINER for the same reason ensure_team_season_enrollment() is: a
-- delegated manager's removal on a club team can target a season under an
-- account_id they hold no membership of. The caller already proved they may
-- write this team's roster — team_roster_write ran before this trigger fired.
security definer
set search_path = public
as $$
begin
  delete from public.season_roster sr
   using public.seasons se
   where sr.season_id = se.id
     and se.team_id = old.team_id
     and se.archived = false
     and sr.athlete_id = old.athlete_id;

  return old;
end;
$$;

drop trigger if exists team_roster_season_unenrollment on public.team_roster;
create trigger team_roster_season_unenrollment
  after delete on public.team_roster
  for each row execute function public.unenroll_athlete_from_team_seasons();
