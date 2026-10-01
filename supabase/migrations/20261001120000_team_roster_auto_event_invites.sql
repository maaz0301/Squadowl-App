-- A player added to a team after its events were created is connected to the schedule.
--
-- team_roster inserts already enroll the athlete on the team's season
-- (20260902130000), but event_availability rows are only written when an event is
-- saved, so a late-added player stayed off every upcoming event's RSVP list until
-- a coach picked them in a prompt. Do it here so every path that adds to a team
-- (manual add, import, evaluations, web) behaves the same.
--
-- Scoped to the team's own roster inserts, not season_roster, on purpose: the
-- season roster is also back-filled from attached assessments, and inviting those
-- rows is what inflated events to 999/2004 "pending" (20260828120000).
-- Only upcoming events (end/start date today or later); past events are history.
-- do nothing on conflict: an existing yes/maybe/no is never reset to pending.
create or replace function public.invite_team_player_to_upcoming_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_availability (season_event_id, roster_id, response)
  select ev.id, sr.id, 'pending'
    from public.seasons se
    join public.season_roster sr on sr.season_id = se.id and sr.athlete_id = new.athlete_id
    join public.season_events ev on ev.season_id = se.id
   where se.team_id = new.team_id
     and se.archived = false
     and coalesce(ev.end_date, ev.event_date) >= current_date
  on conflict (season_event_id, roster_id) do nothing;

  return new;
end;
$$;

-- Named to sort after team_roster_season_enrollment: same-timing triggers fire in
-- name order, and this one needs the season_roster row that trigger creates.
drop trigger if exists team_roster_zz_event_invites on public.team_roster;
create trigger team_roster_zz_event_invites
  after insert on public.team_roster
  for each row execute function public.invite_team_player_to_upcoming_events();
