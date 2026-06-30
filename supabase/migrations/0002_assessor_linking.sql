-- ============================================================================
-- Migration 0002 — Assessor (and guardian) account linking
-- ----------------------------------------------------------------------------
-- Connects an invited assessor's `tryout_assessors` row to a real auth user so
-- they can log in and score. Works in both directions:
--   * invite-before-signup : linked when the user signs up (handle_new_user).
--   * invite-after-signup  : linked when the assessor row is inserted (trigger).
-- Same idea links a guardian's email to canonical athletes for the portal.
-- ============================================================================

-- 1. Extend the new-user bootstrap to claim pending invites by email.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_account_id uuid;
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );

  insert into public.accounts (type, name, plan_tier)
  values ('individual',
          coalesce(new.raw_user_meta_data->>'display_name', 'My Account'),
          'free')
  returning id into new_account_id;

  insert into public.memberships (account_id, user_id, role)
  values (new_account_id, new.id, 'owner');

  -- Claim assessor invites addressed to this email.
  update public.tryout_assessors
     set user_id = new.id, joined_at = now()
   where user_id is null
     and email is not null
     and lower(email) = lower(new.email);

  -- Claim guardian links addressed to this email.
  update public.athletes
     set guardian_user_id = new.id
   where guardian_user_id is null
     and guardian_email is not null
     and lower(guardian_email) = lower(new.email);

  return new;
end;
$$;

-- 2. When an assessor is invited AFTER they already have an account, link on insert.
create or replace function public.link_assessor_to_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null and new.email is not null then
    select id into new.user_id
      from public.profiles
     where lower(email) = lower(new.email)
     limit 1;
    if new.user_id is not null then
      new.joined_at = now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_assessor on public.tryout_assessors;
create trigger trg_link_assessor
  before insert on public.tryout_assessors
  for each row execute function public.link_assessor_to_user();
