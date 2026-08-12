-- accept_athlete_share() copied the guardian_name/email/phone text snapshot onto the
-- new athlete row but never set guardian_user_id, so the athlete lost its RLS-visible
-- link to the guardian's account the moment a coach accepted the share (can_access_athlete
-- and the guardian read policies key off athletes.guardian_user_id, not the email text).
create or replace function public.accept_athlete_share(p_share_id uuid, p_tryout_id uuid)
returns public.athlete_shares
language plpgsql security definer set search_path = public as $$
declare
  v_share public.athlete_shares;
  v_new_athlete_id uuid;
  v_participant_id uuid;
begin
  select * into v_share from public.athlete_shares where id = p_share_id for update;
  if v_share.id is null then
    raise exception 'Share not found';
  end if;
  if not public.has_account_role(v_share.coach_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Not authorized to accept this share';
  end if;
  if v_share.status <> 'shared' then
    raise exception 'Share is no longer pending';
  end if;
  if not exists (select 1 from public.tryouts t where t.id = p_tryout_id and t.account_id = v_share.coach_account_id) then
    raise exception 'Tryout does not belong to this account';
  end if;

  insert into public.athletes (
    account_id, first_name, last_name, year_of_birth, default_position,
    guardian_user_id, guardian_name, guardian_email, guardian_phone,
    medical_info, about, avatar_url
  ) values (
    v_share.coach_account_id, v_share.athlete_first_name, v_share.athlete_last_name,
    v_share.athlete_year_of_birth, v_share.athlete_position,
    v_share.guardian_user_id, v_share.athlete_guardian_name, v_share.athlete_guardian_email, v_share.athlete_guardian_phone,
    v_share.athlete_medical_info, v_share.athlete_about, v_share.athlete_avatar_url
  ) returning id into v_new_athlete_id;

  insert into public.tryout_participants (tryout_id, athlete_id, registration_source)
  values (p_tryout_id, v_new_athlete_id, 'manual')
  returning id into v_participant_id;

  update public.athlete_shares
  set status = 'assigned', assigned_tryout_id = p_tryout_id,
      assigned_athlete_id = v_new_athlete_id, assigned_participant_id = v_participant_id
  where id = p_share_id
  returning * into v_share;

  update public.athlete_shares
  set status = 'withdrawn'
  where athlete_id = v_share.athlete_id and id <> p_share_id and status = 'shared';

  return v_share;
end;
$$;

-- Backfill: any athlete created by a previously-accepted share is still missing its
-- guardian link. Re-attach it from the share's snapshot so existing affected players
-- (including reachraza@yopmail.com's) reappear for their guardian immediately.
update public.athletes a
set guardian_user_id = s.guardian_user_id
from public.athlete_shares s
where s.assigned_athlete_id = a.id
  and s.status = 'assigned'
  and a.guardian_user_id is null;
