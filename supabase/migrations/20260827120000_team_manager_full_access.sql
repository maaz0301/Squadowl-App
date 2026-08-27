-- ============================================================================
-- Team manager: close the access gaps short of full parity on their own team
--               (saving events, delegating other managers, editing the
--               athlete profile itself, and that team's payment records).
-- ----------------------------------------------------------------------------
-- 20260818120000_team_managers.sql deliberately drew the line short of
-- account-level rights: a delegate could run the team's roster/schedule/chat
-- but not delegate other managers, not edit an athlete's own profile fields
-- (only the roster linkage tables), and not touch payments at all (billing
-- was explicitly called out as staying account-only).
--
-- This migration keeps two of those boundaries (deleting the club's team,
-- and account-wide billing across every team) and widens exactly three
-- predicates, each a pure superset — every input that was TRUE before stays
-- TRUE — same shape as the original migration's own widenings:
--
--   1. can_delegate_team(): a team manager may now invite/remove other
--      managers on the SAME team they already manage. They still cannot
--      delegate a team they don't manage, and delegating doesn't grant the
--      new invitee anything beyond the same team-scoped reach.
--   2. athletes_write: a team manager may now edit the profile (name, DOB,
--      guardian contact, etc.) of an athlete who is on their team's roster
--      (directly via team_roster, or via a season_roster row on one of that
--      team's seasons) — not just add/remove the roster link, which was all
--      the previous migration covered.
--   3. payments_read / payments_write: a team manager may now see and manage
--      payment records tied to THEIR team specifically — a payment against a
--      tryout linked to the team, or against an athlete on the team's roster.
--      This does not expose the rest of the club's payments: getEnterprisePayments()
--      still filters by account_id, so a delegate's own payments dashboard
--      (gated on their own plan tier) shows nothing extra; this only unblocks
--      row-level reads/writes scoped to their team when the app needs to look
--      up a specific payment (e.g. a registration fee for one of their players).
--   4. create_season_event_for_caller(): a REGRESSION fix, not a widening —
--      see the section itself.
-- ============================================================================

-- 1. Delegation: a manager of a team may hand it to (or revoke) another
-- manager. Still owner/admin OR the team's own delegate — never a delegate of
-- a *different* team, and never someone with no relationship to this one.
create or replace function public.can_delegate_team(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams te where te.id = t
      and public.has_account_role(te.account_id, array['owner','admin']::membership_role[])
  ) or public.is_team_manager(t);
$$;

-- 2. Athlete profile writes: same team-scoping already used by
-- can_access_athlete (read side) in 20260818120000_team_managers.sql, applied
-- to the write policy. Insert is unaffected in practice — athlete creation
-- goes through the SECURITY DEFINER create_athlete(s)_for_caller() RPCs,
-- which bypass this policy entirely — this only ever adds the UPDATE path a
-- team manager needs to fix a player's name/DOB/guardian info.
drop policy if exists athletes_write on public.athletes;
create policy athletes_write on public.athletes
  for all using (
    public.has_account_role(account_id, array['owner','admin','coach']::membership_role[])
    or exists (
      select 1 from public.team_roster tr
      where tr.athlete_id = athletes.id and public.is_team_manager(tr.team_id)
    )
    or exists (
      select 1 from public.season_roster sr
      join public.seasons se on se.id = sr.season_id
      where sr.athlete_id = athletes.id
        and se.team_id is not null
        and public.is_team_manager(se.team_id)
    )
  )
  with check (
    public.has_account_role(account_id, array['owner','admin','coach']::membership_role[])
    or exists (
      select 1 from public.team_roster tr
      where tr.athlete_id = athletes.id and public.is_team_manager(tr.team_id)
    )
    or exists (
      select 1 from public.season_roster sr
      join public.seasons se on se.id = sr.season_id
      where sr.athlete_id = athletes.id
        and se.team_id is not null
        and public.is_team_manager(se.team_id)
    )
  );

-- 3. Payments: scoped to the manager's own team via the payment's tryout or
-- athlete, mirroring can_access_athlete/can_access_tryout's team-manager
-- clauses. account_id-only rows (no tryout_id or athlete_id — a manual/other
-- account-level charge) stay owner/admin-only, since there is nothing here to
-- scope a team manager's access to.
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select using (
    public.has_account_role(account_id, array['owner','admin']::membership_role[])
    or (tryout_id is not null and exists (
      select 1 from public.tryouts ty
      where ty.id = payments.tryout_id
        and ty.team_id is not null
        and public.is_team_manager(ty.team_id)
    ))
    or (athlete_id is not null and exists (
      select 1 from public.team_roster tr
      where tr.athlete_id = payments.athlete_id
        and public.is_team_manager(tr.team_id)
    ))
    or (athlete_id is not null and exists (
      select 1 from public.season_roster sr
      join public.seasons se on se.id = sr.season_id
      where sr.athlete_id = payments.athlete_id
        and se.team_id is not null
        and public.is_team_manager(se.team_id)
    ))
  );

drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments
  for all using (
    public.has_account_role(account_id, array['owner','admin']::membership_role[])
    or (tryout_id is not null and exists (
      select 1 from public.tryouts ty
      where ty.id = payments.tryout_id
        and ty.team_id is not null
        and public.is_team_manager(ty.team_id)
    ))
    or (athlete_id is not null and exists (
      select 1 from public.team_roster tr
      where tr.athlete_id = payments.athlete_id
        and public.is_team_manager(tr.team_id)
    ))
    or (athlete_id is not null and exists (
      select 1 from public.season_roster sr
      join public.seasons se on se.id = sr.season_id
      where sr.athlete_id = payments.athlete_id
        and se.team_id is not null
        and public.is_team_manager(se.team_id)
    ))
  )
  with check (
    public.has_account_role(account_id, array['owner','admin']::membership_role[])
    or (tryout_id is not null and exists (
      select 1 from public.tryouts ty
      where ty.id = payments.tryout_id
        and ty.team_id is not null
        and public.is_team_manager(ty.team_id)
    ))
    or (athlete_id is not null and exists (
      select 1 from public.team_roster tr
      where tr.athlete_id = payments.athlete_id
        and public.is_team_manager(tr.team_id)
    ))
    or (athlete_id is not null and exists (
      select 1 from public.season_roster sr
      join public.seasons se on se.id = sr.season_id
      where sr.athlete_id = payments.athlete_id
        and se.team_id is not null
        and public.is_team_manager(se.team_id)
    ))
  );

-- ----------------------------------------------------------------------------
-- 4. create_season_event_for_caller(): restore team-manager access.
-- ----------------------------------------------------------------------------
-- This is a REGRESSION FIX, not a new grant. 20260826180000 moved event
-- creation into a SECURITY DEFINER function to collapse ~55 round trips into
-- one, and a definer function skips RLS entirely — so it has to re-state, by
-- hand, exactly what the policies it replaced permitted. It re-stated only
-- half: `season_events_write`'s account-role check, dropping
-- `season_events_manager_write` (20260818120000), which permits a delegated
-- manager of the season's team.
--
-- RLS ORs permissive policies together, so the union of those two IS the
-- authorization the client had before that migration — and a team manager
-- saving an event on their own team got "Not authorized for this season"
-- where the pre-RPC path had always worked. Worse, it surfaces rather than
-- falling back: the client only retries the slow path on PGRST202/42883 (a
-- function that isn't deployed), and this raise is P0001, so the save just
-- fails.
--
-- The guard below is that union, stated explicitly rather than via
-- can_manage_team() so the `team_id is null` case (a season with no team, no
-- manager possible) still reads clearly and stays account-role-only.
--
-- Nothing else in the function changes; the body is reproduced verbatim
-- because `create or replace function` has no way to patch just the guard.
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
  -- The two OR'd branches mirror season_events_write and
  -- season_events_manager_write respectively.
  if not exists (
    select 1 from public.seasons se
    where se.id = p_season_id
      and (
        public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
        or (se.team_id is not null and public.is_team_manager(se.team_id))
      )
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

-- ----------------------------------------------------------------------------
-- 5. get_event_availability(): deploy it, and let team managers through it.
-- ----------------------------------------------------------------------------
-- The mobile client has been CALLING this function since the RSVP work, but
-- the migration defining it only ever landed in the web repo — so on this
-- database it doesn't exist. The client falls back to reading
-- event_availability directly, which evaluates availability_read once per RSVP
-- row and trips the 8s statement timeout on a full-roster event. That is the
-- "event_availability read hit the statement timeout" console error, and the
-- reason the schedule reports "RSVPs couldn't be loaded".
--
-- The companion indexes migration from the web repo is deliberately NOT
-- ported: every index it creates already exists here under a different name
-- (idx_event_availability_event, idx_season_roster_season,
-- idx_season_roster_athlete, idx_season_events_season, idx_athletes_guardian —
-- all from 0001), so applying it would only add five redundant duplicates.
--
-- AUTHORIZATION: the web copy reconstructed the check by hand (its own header
-- says so and asks for a diff against the real policy before applying) and got
-- it wrong for this schema twice over — it used has_account_access() where the
-- policy uses can_access_season(), and it omitted team managers entirely, so
-- deploying it as written would have swapped one team-manager lockout for
-- another. availability_read (0001) is:
--
--   exists (select 1 from season_events ev
--           where ev.id = season_event_id and can_access_season(ev.season_id))
--
-- ...so that predicate is used verbatim below. can_access_season() already
-- encapsulates account staff, the season's guardians, AND a delegated manager
-- of the season's team (widened in 20260818120000), which is what makes this
-- both exactly the policy and correct for team managers. Calling it rather than
-- re-deriving it is the whole point: there is one definition to keep in sync.
--
-- The CTE evaluates it once per EVENT (at most one row per p_event_ids entry)
-- instead of once per RSVP row, which is the actual fix.
--
-- Keyset-paged (p_after_id / p_limit, same shape as
-- get_evaluations_for_tryouts) because a set-returning RPC is still capped by
-- PostgREST's db-max-rows: the single-shot form would silently return 1000 rows
-- and no more, undercounting RSVPs on exactly the big events this exists to
-- fix. The extra arguments default, so a one-argument caller keeps working.
--
-- The old one-argument signature is dropped first: `create or replace` would
-- otherwise leave an overload behind, and a call naming only p_event_ids would
-- then be ambiguous.
drop function if exists public.get_event_availability(uuid[]);

create or replace function public.get_event_availability(
  p_event_ids uuid[],
  p_after_id  uuid default null,
  p_limit     int  default 1000
)
returns setof public.event_availability
language sql
stable
security definer
set search_path = public
as $$
  with authorized as (
    select se.id
    from public.season_events se
    where se.id = any(p_event_ids)
      and public.can_access_season(se.season_id)
  )
  select ea.*
  from public.event_availability ea
  join authorized a on a.id = ea.season_event_id
  where (p_after_id is null or ea.id > p_after_id)
  order by ea.id
  limit p_limit;
$$;

revoke all on function public.get_event_availability(uuid[], uuid, int) from public;
revoke all on function public.get_event_availability(uuid[], uuid, int) from anon;
grant execute on function public.get_event_availability(uuid[], uuid, int) to authenticated;
