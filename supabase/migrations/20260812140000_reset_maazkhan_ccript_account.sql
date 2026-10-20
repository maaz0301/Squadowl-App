-- One-off: reset maaz.khan@ccript.com back to a brand-new free account.
--
-- This profile has two separate memberships:
--   1. owner on account 5a5b3d7d-861f-4aa1-803c-cd4398201e0b (their own account,
--      club tier) -- this is the one being wiped and recreated fresh.
--   2. guardian on account 6000bcc2-1bb4-409e-9a19-3343444fc34d (raza0301301's
--      test account) -- NOT wiped (belongs to a different owner); only this
--      profile's guardian footprint on it is removed.
do $$
declare
  v_profile_id uuid;
  v_display_name text;
  v_old_account_id uuid := '5a5b3d7d-861f-4aa1-803c-cd4398201e0b';
  v_new_account_id uuid;
begin
  select id, display_name into v_profile_id, v_display_name
  from public.profiles
  where lower(email) = lower('maaz.khan@ccript.com');

  if v_profile_id is null then
    -- One-off fix for an existing account: nothing to reset on a fresh database.
    raise notice 'profile not found for maaz.khan@ccript.com, skipping';
    return;
  end if;

  -- Wipe the owned account. Cascades (via account_id/tryout_id/season_id FKs
  -- declared "on delete cascade" in 0001_initial_schema.sql) take teams,
  -- athletes, seasons + season_events/season_roster, tryouts + participants/
  -- evaluations/evaluation_scores/registrations/tryout_assessors/
  -- friend_packages, payments, portal_invites, and this account's own
  -- membership row with it.
  delete from public.accounts where id = v_old_account_id;

  -- Recreate a brand-new free account, mirroring handle_new_user()'s signup bootstrap.
  insert into public.accounts (type, name, plan_tier, subscription_status)
  values ('individual', coalesce(v_display_name, 'My Account'), 'free', 'none')
  returning id into v_new_account_id;

  insert into public.memberships (account_id, user_id, role)
  values (v_new_account_id, v_profile_id, 'owner');

  -- Reset onboarding so the app treats this like a fresh signup.
  update public.profiles
  set onboarding_completed = false,
      onboarding_steps = '{
        "createTeam": false, "createAssessment": false, "inviteAssessors": false,
        "addPlayers": false, "scorePlayers": false
      }'::jsonb
  where id = v_profile_id;

  -- Remove this profile's guardian footprint wherever it appears (other accounts'
  -- rosters/invites/shares), without touching the athletes/accounts they belong to.
  delete from public.memberships
  where user_id = v_profile_id and role = 'guardian';

  update public.athletes
  set guardian_user_id = null
  where guardian_user_id = v_profile_id;

  delete from public.portal_invites
  where lower(email) = lower('maaz.khan@ccript.com')
     or accepted_user_id = v_profile_id;

  delete from public.athlete_shares
  where guardian_user_id = v_profile_id;
end $$;
