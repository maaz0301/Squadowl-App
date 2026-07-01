-- ============================================================================
-- Migration 0003 — Public Registration RPC
-- ----------------------------------------------------------------------------
-- Allows anonymous public users to submit registrations without violating RLS.
-- This is a security definer function, meaning it acts as the database owner.
-- It checks if the registration_code is valid and if the tryout registration 
-- is open before inserting into the registrations table.
-- ============================================================================

create or replace function public.submit_public_registration(
  code text,
  payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t_id uuid;
  inserted_row jsonb;
begin
  -- 1. Look up the tryout ID safely
  select id into t_id 
    from public.tryouts
   where registration_code = code 
     and registration_open = true;

  -- 2. Reject if not found or closed
  if t_id is null then
    raise exception 'Invalid or closed registration code';
  end if;

  -- 3. Insert the registration
  insert into public.registrations (
    tryout_id,
    first_name,
    last_name,
    year_of_birth,
    position_trying_out_for,
    guardian_name,
    guardian_email,
    guardian_phone,
    current_team,
    current_level,
    about_player,
    medical_info,
    friend1_name,
    friend2_name,
    status
  ) values (
    t_id,
    payload->>'firstName',
    payload->>'lastName',
    (payload->>'yearOfBirth')::int,
    payload->>'positionTryingOutFor',
    payload->>'guardianName',
    payload->>'guardianEmail',
    payload->>'guardianPhone',
    payload->>'currentTeam',
    payload->>'currentLevel',
    payload->>'aboutPlayer',
    payload->>'medicalInfo',
    payload->>'friend1Name',
    payload->>'friend2Name',
    'pending'
  ) returning to_jsonb(public.registrations.*) into inserted_row;

  return inserted_row;
end;
$$;
