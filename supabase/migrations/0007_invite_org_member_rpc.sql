-- ============================================================================
-- Migration 0007 — Invite organization member RPC
-- ----------------------------------------------------------------------------
-- Allows the client to securely lookup a user by email and insert a
-- membership record for them.
-- ============================================================================

create or replace function public.invite_org_member_by_email(account_uuid uuid, lookup_email text, org_role text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  target_name text;
  new_membership_id uuid;
  result json;
begin
  -- 1. Look up user by email
  select id, display_name into target_user_id, target_name
  from public.profiles
  where lower(email) = lower(lookup_email);

  if target_user_id is null then
    raise exception 'User not found';
  end if;

  -- 2. Insert into memberships (upsert if exists)
  insert into public.memberships (account_id, user_id, role)
  values (account_uuid, target_user_id, org_role::membership_role)
  on conflict (account_id, user_id) do update set role = excluded.role
  returning id into new_membership_id;

  -- 3. Return the new member representation
  select json_build_object(
    'id', new_membership_id,
    'userId', target_user_id,
    'role', org_role,
    'email', lookup_email,
    'name', target_name,
    'status', 'active'
  ) into result;

  return result;
end;
$$;
