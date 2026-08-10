-- ============================================================================
-- Stripe Connect + registration fee collection
-- ----------------------------------------------------------------------------
-- Coach/Coach+/Club accounts collect registration fees from guardians via a
-- Stripe Connect Standard account (direct charges, so the coach — not
-- TryoutHQ — pays Stripe's processing fee). TryoutHQ takes a 0.5% cut via
-- application_fee_amount on each charge.
-- ============================================================================

alter table public.accounts
  add column if not exists stripe_connect_account_id text,
  add column if not exists stripe_connect_charges_enabled boolean not null default false,
  add column if not exists stripe_connect_payouts_enabled boolean not null default false;

alter table public.tryouts
  add column if not exists registration_fee_cents int;

alter table public.payments
  add column if not exists platform_fee_cents int;

-- Lets the payment webhook find the registration a completed Checkout
-- Session belongs to, and gives create-registration-payment an idempotency
-- check so a guardian can't spin up two charges for the same registration.
alter table public.registrations
  add column if not exists stripe_checkout_session_id text;

-- ----------------------------------------------------------------------------
-- submit_public_registration: also return the tryout's fee + connect status
-- so the public registration page knows whether to route to a payment step.
-- ----------------------------------------------------------------------------
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

  return inserted_row || jsonb_build_object(
    'registrationFeeCents', fee_cents,
    'connectChargesEnabled', coalesce(charges_enabled, false)
  );
end;
$$;
