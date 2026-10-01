-- guardian_remove_athlete(athlete_id) — lets a guardian delete an athlete from
-- their own "My Athletes" list.
--
-- A guardian has no write access to athletes (athletes_update is staff-only), so a
-- plain client update would silently change nothing. This runs as SECURITY DEFINER
-- and authorizes the caller against the athlete the same way get_guardian_rosters()
-- matches "mine": the linked guardian_user_id, or guardian_email when the accounts
-- were never linked up.
--
-- What it removes is the guardian's link, not the coach's data: the athlete record,
-- team rosters, scores and history stay with the coach. Both link columns are
-- cleared, because get_guardian_rosters() matches on either and would otherwise
-- bring the athlete straight back through the email. A coach can re-invite the
-- guardian later to link again.

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

  if not (
    v_guardian_user_id = auth.uid()
    or (v_caller_email is not null and v_guardian_email = v_caller_email::citext)
  ) then
    raise exception 'Not authorized to remove this athlete' using errcode = '42501';
  end if;

  update public.athletes
     set guardian_user_id = null,
         guardian_email = null
   where id = p_athlete_id;
end;
$$;

revoke all on function public.guardian_remove_athlete(uuid) from public;
grant execute on function public.guardian_remove_athlete(uuid) to authenticated;

-- Supabase grants new public functions to anon by default; only signed-in users should call this.
revoke execute on function public.guardian_remove_athlete(uuid) from anon;
