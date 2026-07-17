-- ============================================================================
-- Migration — Update organization member role RPC
-- ----------------------------------------------------------------------------
-- A direct `update` on `memberships` from the client is subject to the
-- `memberships_write` RLS policy. When the acting user is not visible to that
-- policy the update simply affects zero rows *without* raising an error, so the
-- client reported success while the role never actually changed (staff role
-- stuck on "Coach" after saving).
--
-- This SECURITY DEFINER RPC mirrors `invite_org_member_by_email`: it performs
-- its own owner/admin authorization check and then updates the role, returning
-- the updated row. It raises a clear exception when the caller is not allowed
-- or the member does not exist, so the UI can surface a real error instead of
-- silently pretending to succeed.
-- ============================================================================

create or replace function public.update_org_member_role(member_id uuid, new_role text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  target_account uuid;
  updated_role text;
  result json;
begin
  -- 1. Staff members with an org-level role live in `memberships`.
  select account_id into target_account
  from public.memberships
  where id = member_id;

  if target_account is not null then
    if not public.has_account_role(
         target_account, array['owner','admin']::membership_role[]) then
      raise exception 'Not authorized to manage this organization';
    end if;

    update public.memberships
    set role = new_role::membership_role
    where id = member_id
    returning role into updated_role;

    select json_build_object('id', member_id, 'role', updated_role) into result;
    return result;
  end if;

  -- 2. Otherwise the member may be a tryout-scoped assessor.
  select ty.account_id into target_account
  from public.tryout_assessors ta
  join public.tryouts ty on ty.id = ta.tryout_id
  where ta.id = member_id;

  if target_account is null then
    raise exception 'Member not found';
  end if;

  if not public.has_account_role(
       target_account, array['owner','admin']::membership_role[]) then
    raise exception 'Not authorized to manage this organization';
  end if;

  if new_role not in ('lead', 'assistant', 'assessor') then
    raise exception 'Assessors can only be assigned an assessor role';
  end if;

  update public.tryout_assessors
  set role = new_role::assessor_role
  where id = member_id
  returning role into updated_role;

  select json_build_object('id', member_id, 'role', updated_role) into result;
  return result;
end;
$$;

grant execute on function public.update_org_member_role(uuid, text) to authenticated;
