-- ============================================================================
-- Complete wipe of maaz.khan@yopmail.com to allow fresh sign-up
-- ============================================================================

do $$
declare
  v_uid uuid;
  v_acc_id uuid;
begin
  -- 1. Find profile / auth user id
  select id into v_uid from auth.users where lower(email) = lower('maaz.khan@yopmail.com');
  if v_uid is null then
    select id into v_uid from public.profiles where lower(email) = lower('maaz.khan@yopmail.com');
  end if;

  if v_uid is not null then
    -- 2. Delete any accounts owned by this user (cascades to their teams/tryouts/etc.)
    for v_acc_id in (select account_id from public.memberships where user_id = v_uid and role = 'owner') loop
      delete from public.accounts where id = v_acc_id;
    end loop;

    -- 3. Delete team manager links
    delete from public.team_managers where user_id = v_uid or invited_by = v_uid;

    -- 4. Delete memberships and clear guardian links
    delete from public.memberships where user_id = v_uid;
    update public.athletes set guardian_user_id = null where guardian_user_id = v_uid;
    delete from public.portal_invites where lower(email) = lower('maaz.khan@yopmail.com') or accepted_user_id = v_uid;
    delete from public.athlete_shares where guardian_user_id = v_uid or coach_user_id = v_uid or author_user_id = v_uid;
    delete from public.fcm_tokens where user_id = v_uid;

    -- 5. Delete profile and auth user
    delete from public.profiles where id = v_uid or lower(email) = lower('maaz.khan@yopmail.com');
    delete from auth.users where id = v_uid or lower(email) = lower('maaz.khan@yopmail.com');
  else
    -- Fallback cleanup by email
    delete from public.profiles where lower(email) = lower('maaz.khan@yopmail.com');
    delete from auth.users where lower(email) = lower('maaz.khan@yopmail.com');
  end if;
end $$;
