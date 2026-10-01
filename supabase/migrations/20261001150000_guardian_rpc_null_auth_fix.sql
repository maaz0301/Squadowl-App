-- Security fix: guardian_remove_athlete and guardian_leave_season let ANY signed-in user act on
-- an athlete whose guardian_user_id or guardian_email is null.
--
-- The check was `if not (guardian_user_id = auth.uid() or (email match))`. With a null column the
-- comparison is NULL, `not NULL` is NULL, and plpgsql treats an IF on NULL as false, so the
-- "Not authorized" exception never fired. Found by calling guardian_remove_athlete as the founder
-- (not this athlete's guardian) and getting 204 instead of 42501. Both checks are now wrapped in
-- coalesce(..., false) so an unknown comparison counts as "not the guardian".

create or replace function public.guardian_remove_athlete(p_athlete_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  v_guardian_user_id uuid;
  v_guardian_email citext;
  v_found boolean := false;
begin
  select true, a.guardian_user_id, a.guardian_email
    into v_found, v_guardian_user_id, v_guardian_email
  from public.athletes a
  where a.id = p_athlete_id;

  if not coalesce(v_found, false) then
    raise exception 'Athlete not found' using errcode = 'P0002';
  end if;

  -- coalesce: with a null guardian_user_id or guardian_email the comparisons are NULL, and
  -- `if not (NULL)` is NULL (not true), which let any signed-in user through.
  if not (
    coalesce(v_guardian_user_id = auth.uid(), false)
    or coalesce(v_caller_email is not null and v_guardian_email = v_caller_email::citext, false)
  ) then
    raise exception 'Not authorized to remove this athlete' using errcode = '42501';
  end if;

  update public.athletes
     set guardian_user_id = null,
         guardian_email = null
   where id = p_athlete_id;
end;
$$;


create or replace function public.guardian_leave_season(p_season_roster_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_season_id uuid;
  v_team_id uuid;
  v_guardian_user_id uuid;
  v_guardian_email citext;
  v_caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  v_removed integer := 0;
begin
  select sr.athlete_id, sr.season_id, se.team_id, a.guardian_user_id, a.guardian_email
    into v_athlete_id, v_season_id, v_team_id, v_guardian_user_id, v_guardian_email
  from public.season_roster sr
  join public.seasons se on se.id = sr.season_id
  join public.athletes a on a.id = sr.athlete_id
  where sr.id = p_season_roster_id;

  if v_athlete_id is null then
    raise exception 'Roster entry not found' using errcode = 'P0002';
  end if;

  -- coalesce: with a null guardian_user_id or guardian_email the comparisons are NULL, and
  -- `if not (NULL)` is NULL (not true), which let any signed-in user through.
  if not (
    coalesce(v_guardian_user_id = auth.uid(), false)
    or coalesce(v_caller_email is not null and v_guardian_email = v_caller_email::citext, false)
  ) then
    raise exception 'Not authorized to leave this team' using errcode = '42501';
  end if;

  delete from public.season_roster where id = p_season_roster_id;
  get diagnostics v_removed = row_count;
  if v_removed = 0 then
    raise exception 'Could not leave this team' using errcode = 'P0002';
  end if;

  -- A season with no team is a standalone season; there is no roster to leave.
  if v_team_id is not null then
    delete from public.team_roster
     where team_id = v_team_id
       and athlete_id = v_athlete_id;

    delete from public.season_roster sr
     using public.seasons se
     where sr.season_id = se.id
       and se.team_id = v_team_id
       and se.archived = false
       and sr.athlete_id = v_athlete_id;
  end if;
end;
$$;

revoke all on function public.guardian_remove_athlete(uuid) from public;
revoke execute on function public.guardian_remove_athlete(uuid) from anon;
grant execute on function public.guardian_remove_athlete(uuid) to authenticated;
revoke all on function public.guardian_leave_season(uuid) from public;
revoke execute on function public.guardian_leave_season(uuid) from anon;
grant execute on function public.guardian_leave_season(uuid) to authenticated;
