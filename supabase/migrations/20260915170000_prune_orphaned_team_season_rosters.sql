-- One-time cleanup for 20260915150000_team_roster_removal_unenrolls_season.sql.
--
-- That trigger only fires on removals from now on. Players a coach removed from
-- a team before it existed kept their season_roster row on the team's active
-- season, so their guardian still saw the team even though the coach's Players
-- tab (which reads team_roster) showed them gone.
--
-- Scope matches the trigger exactly: active (non-archived) seasons that belong to
-- a team, where the athlete is no longer on that team's roster. Archived seasons
-- keep their history. Rows are copied to backup tables first so this can be
-- undone; event_availability cascades off season_roster, so it is backed up too.
create table if not exists public._backup_20260915_orphaned_season_roster as
  select sr.*
    from public.season_roster sr
    join public.seasons se on se.id = sr.season_id
   where se.archived = false
     and se.team_id is not null
     and not exists (
       select 1 from public.team_roster tr
        where tr.team_id = se.team_id and tr.athlete_id = sr.athlete_id
     );

create table if not exists public._backup_20260915_orphaned_event_availability as
  select ea.*
    from public.event_availability ea
   where ea.roster_id in (select id from public._backup_20260915_orphaned_season_roster);

-- Backups hold guardian-adjacent data; keep them out of the PostgREST API.
alter table public._backup_20260915_orphaned_season_roster enable row level security;
alter table public._backup_20260915_orphaned_event_availability enable row level security;
revoke all on public._backup_20260915_orphaned_season_roster from anon, authenticated;
revoke all on public._backup_20260915_orphaned_event_availability from anon, authenticated;

delete from public.season_roster sr
 using public.seasons se
 where sr.season_id = se.id
   and se.archived = false
   and se.team_id is not null
   and not exists (
     select 1 from public.team_roster tr
      where tr.team_id = se.team_id and tr.athlete_id = sr.athlete_id
   );
