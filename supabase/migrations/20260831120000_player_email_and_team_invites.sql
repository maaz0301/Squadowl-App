-- Player email, and portal invites that can hang off a team instead of a season.
--
-- 1. An athlete only carried a *guardian* email, so nothing on the roster could
--    reach the player themselves. season_roster.player_email already existed but
--    is scoped to a single season enrollment; this puts the address on the
--    canonical athlete so the assessment roster, the team roster, the season
--    roster and the player profile all read and write the same value.
--
-- 2. portal_invites could only be scoped to a season. Inviting a *team's* roster
--    has no season to hang off, so team_id joins season_id as a second, equally
--    optional scope. Both stay nullable: an invite is scoped to one or the
--    other, never required to have both.

alter table public.athletes
  add column if not exists player_email citext;

alter table public.portal_invites
  add column if not exists team_id uuid references public.teams(id) on delete cascade;

create index if not exists idx_portal_invites_team on public.portal_invites(team_id);

-- create_athlete_for_caller() enumerates the columns it inserts, so player_email
-- is invisible to every "Add Player" path until it is listed here. Body is
-- otherwise unchanged from 20260812230000_create_athlete_for_caller.sql.
create or replace function public.create_athlete_for_caller(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_account := nullif(payload->>'account_id', '')::uuid;

  -- Trust the client's account only if the caller really has write access to it.
  if v_account is null or not exists (
    select 1 from public.memberships
    where user_id = auth.uid()
      and account_id = v_account
      and role in ('owner', 'admin', 'coach')
  ) then
    select account_id into v_account
    from public.memberships
    where user_id = auth.uid()
      and role in ('owner', 'admin', 'coach')
    order by case role::text
               when 'admin' then 0
               when 'coach' then 1
               else 2
             end,
             created_at
    limit 1;
  end if;

  if v_account is null then
    raise exception 'No account with permission to add players';
  end if;

  insert into public.athletes (
    account_id, first_name, last_name, year_of_birth, guardian_name,
    guardian_email, guardian_phone, guardian_user_id, player_email,
    medical_info, about, avatar_url
  ) values (
    v_account,
    payload->>'first_name',
    payload->>'last_name',
    nullif(payload->>'year_of_birth', '')::int,
    nullif(payload->>'guardian_name', ''),
    nullif(payload->>'guardian_email', ''),
    nullif(payload->>'guardian_phone', ''),
    nullif(payload->>'guardian_user_id', '')::uuid,
    nullif(payload->>'player_email', ''),
    nullif(payload->>'medical_info', ''),
    nullif(payload->>'about', ''),
    nullif(payload->>'avatar_url', '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_athlete_for_caller(jsonb) from public;
grant execute on function public.create_athlete_for_caller(jsonb) to authenticated;

-- The public registration form collects the player's email too, so it has to
-- survive until the registration is converted into an athlete.
alter table public.registrations
  add column if not exists player_email citext;

-- Bulk twin of create_athlete_for_caller(), used by the multi-select
-- "Add N to Roster" path. Same column list, same omission to fix.
-- Body otherwise unchanged from 20260813120000_create_athletes_for_caller_bulk.sql.
create or replace function public.create_athletes_for_caller(account_hint uuid, players jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_ids uuid[];
begin
  if players is null or jsonb_typeof(players) <> 'array' then
    raise exception 'players must be a jsonb array';
  end if;

  v_account := public.resolve_writable_account(account_hint);

  if jsonb_array_length(players) = 0 then
    return array[]::uuid[];
  end if;

  with input as (
    select ord, elem, gen_random_uuid() as id
    from jsonb_array_elements(players) with ordinality as t(elem, ord)
  ),
  ins as (
    insert into public.athletes (
      id, account_id, first_name, last_name, year_of_birth, guardian_name,
      guardian_email, guardian_phone, guardian_user_id, player_email,
      medical_info, about, avatar_url
    )
    select
      i.id,
      v_account,
      i.elem->>'first_name',
      i.elem->>'last_name',
      nullif(i.elem->>'year_of_birth', '')::int,
      nullif(i.elem->>'guardian_name', ''),
      nullif(i.elem->>'guardian_email', ''),
      nullif(i.elem->>'guardian_phone', ''),
      nullif(i.elem->>'guardian_user_id', '')::uuid,
      nullif(i.elem->>'player_email', ''),
      nullif(i.elem->>'medical_info', ''),
      nullif(i.elem->>'about', ''),
      nullif(i.elem->>'avatar_url', '')
    from input i
    returning id
  )
  select array_agg(i.id order by i.ord) into v_ids from input i;

  return v_ids;
end;
$$;

revoke execute on function public.create_athletes_for_caller(uuid, jsonb) from public;
grant execute on function public.create_athletes_for_caller(uuid, jsonb) to authenticated;

-- The public (QR) registration form also enumerates its columns, so it needs the
-- same addition. Body otherwise unchanged from
-- 20260806200000_stripe_connect_registration_fees.sql.
create or replace function public.submit_public_registration(
  code text,
  payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t_id uuid;
  fee_cents int;
  charges_enabled boolean;
  inserted_row jsonb;
begin
  select t.id, t.registration_fee_cents, a.stripe_connect_charges_enabled
    into t_id, fee_cents, charges_enabled
    from public.tryouts t
    join public.accounts a on a.id = t.account_id
   where upper(t.registration_code) = upper(code)
     and t.registration_open = true;

  if t_id is null then
    raise exception 'Invalid or closed registration code';
  end if;

  insert into public.registrations (
    tryout_id,
    first_name,
    last_name,
    year_of_birth,
    position_trying_out_for,
    player_email,
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
    nullif(payload->>'playerEmail', ''),
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

  return inserted_row || jsonb_build_object(
    'registrationFeeCents', fee_cents,
    'connectChargesEnabled', coalesce(charges_enabled, false)
  );
end;
$$;
