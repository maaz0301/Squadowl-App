-- ============================================================================
-- Fix: "Save Event" on a large roster takes ~a minute and the schedule is slow
--      to show the event afterwards.
-- ----------------------------------------------------------------------------
-- Creating an event does two things: insert one `season_events` row, then
-- pre-populate one `event_availability` row per invited player (that table is
-- what gates who receives the event in the guardian portal and who gets the
-- schedule/reminder emails). The client did the second part itself, in chunks
-- of 20 rows, 8 chunks in flight — because a single large insert from the
-- client overran the 8s statement timeout.
--
-- It overran it for the reason this schema has hit repeatedly: every inserted
-- row re-evaluates `availability_write`'s USING clause, which joins
-- season_roster -> athletes and calls has_account_role(). A 1000-player event
-- therefore paid that per row — 50 chunked round trips, each one re-running the
-- authorization check 20 more times, plus the 5 paged `season_roster` reads the
-- client needed first just to learn who to invite. That is the progress bar the
-- coach watches ("Sending invites to N of 1000 guardians...").
--
-- Same fix as create_athletes_for_caller() / insert_tryout_participants_for_caller()
-- / get_event_availability(): authorize ONCE for the season, then do the whole
-- thing set-based inside a SECURITY DEFINER function, where the per-row policy
-- never runs at all. 1000 invites become one statement and one round trip.
--
-- PERMISSIONS ARE UNCHANGED — this changes *when* the check runs, never *what*
-- it permits:
--   * `season_events_write` (0001) permits the insert to callers with
--     owner/admin/coach on the season's account. The guard below is that exact
--     predicate, so nobody who could not already create this event can.
--   * `availability_write` (0001) has `with check (true)`; its USING clause
--     admits the same staff roles (or the row's own guardian). Every row this
--     inserts belongs to the season just authorized and would have been
--     insertable by the same caller one row at a time, which is literally what
--     the client was doing before.
--   * The guardian_emails it returns come from athletes on that season's
--     roster, which `season_roster_read` -> can_access_season() already exposes
--     to this caller — and the client read them itself, for this same purpose,
--     on the path this replaces.
--
-- Roster selection: p_roster_ids null means "everyone on the season roster"
-- (what the UI sends when no subset is picked), and ids that aren't on this
-- season are ignored rather than trusted — the join is the filter.
-- ============================================================================

create or replace function public.create_season_event_for_caller(
  p_season_id  uuid,
  p_event      jsonb,
  p_roster_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event   public.season_events;
  v_date    date;
  v_invited int;
  v_emails  text[];
begin
  -- Once per event, not once per invite. This is the whole point of the function.
  if not exists (
    select 1 from public.seasons se
    where se.id = p_season_id
      and public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
  ) then
    raise exception 'Not authorized for this season';
  end if;

  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'p_event must be a jsonb object';
  end if;

  v_date := (p_event->>'event_date')::date;

  insert into public.season_events (
    season_id, kind, title, event_date, end_date, start_time, end_time, location, notes
  )
  values (
    p_season_id,
    coalesce(nullif(p_event->>'kind', ''), 'game')::season_event_kind,
    p_event->>'title',
    v_date,
    -- season_events_end_date_check requires end_date >= event_date; the client
    -- already defaults a single-day event's end to its start.
    coalesce(nullif(p_event->>'end_date', '')::date, v_date),
    nullif(p_event->>'start_time', ''),
    nullif(p_event->>'end_time', ''),
    nullif(p_event->>'location', ''),
    nullif(p_event->>'notes', '')
  )
  returning * into v_event;

  -- One statement for the whole roster. `on conflict do nothing` keeps a
  -- retrying client idempotent against unique (season_event_id, roster_id).
  with ins as (
    insert into public.event_availability (season_event_id, roster_id, response)
    select v_event.id, sr.id, 'pending'::availability_option
    from public.season_roster sr
    where sr.season_id = p_season_id
      and (p_roster_ids is null or sr.id = any(p_roster_ids))
    on conflict (season_event_id, roster_id) do nothing
    returning 1
  )
  select count(*)::int into v_invited from ins;

  -- Returned with the event so the client doesn't need its own paged roster
  -- read just to know who to email.
  select coalesce(array_agg(distinct at.guardian_email), array[]::text[])
    into v_emails
  from public.season_roster sr
  join public.athletes at on at.id = sr.athlete_id
  where sr.season_id = p_season_id
    and (p_roster_ids is null or sr.id = any(p_roster_ids))
    and at.guardian_email is not null
    and at.guardian_email <> '';

  return jsonb_build_object(
    'event',           to_jsonb(v_event),
    'invited_count',   v_invited,
    'guardian_emails', to_jsonb(v_emails)
  );
end;
$$;

revoke all on function public.create_season_event_for_caller(uuid, jsonb, uuid[]) from public;
revoke all on function public.create_season_event_for_caller(uuid, jsonb, uuid[]) from anon;
grant execute on function public.create_season_event_for_caller(uuid, jsonb, uuid[]) to authenticated;

-- The invite insert and the email lookup both drive off season_roster by
-- season (idx_season_roster_season, 0001) and join athletes on its primary
-- key, so no new index is needed — only current statistics, which the
-- dummy-data generator's bulk inserts leave stale.
analyze public.season_roster;
analyze public.event_availability;
