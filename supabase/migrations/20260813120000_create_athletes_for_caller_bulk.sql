-- ============================================================================
-- Bulk athlete creation for the dummy-data generators.
-- ----------------------------------------------------------------------------
-- 20260812220000 fixed "new row violates row-level security policy for table
-- athletes" on the Add Player path by routing that insert through
-- create_athlete_for_caller(), which resolves the owning account server-side
-- from auth.uid() instead of trusting the client's cached account_id.
--
-- The dummy-data generators (generateTestData / generateDummyTeams) never got
-- that treatment: they still bulk-insert athletes directly with the account_id
-- cached by SupabaseDataSource.ctx(), which ranks *every* membership -- read-only
-- guardian/assessor ones included -- and caches for the JS process lifetime.
-- So the same RLS rejection resurfaced there.
--
-- This adds the bulk twin of that RPC so a chunk of up to 500 generated players
-- is still one round trip, plus a shared account-resolution helper both RPCs
-- use, so their authorization can't drift apart. Authorization is unchanged:
-- owner/admin/coach on the resolved account is still required, and a caller
-- with no staff membership is still refused.
-- ============================================================================

-- Resolve the account to write to: the client's hint when the caller genuinely
-- holds owner/admin/coach on it, otherwise the caller's own best staff account.
create or replace function public.resolve_writable_account(hint uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if hint is not null and exists (
    select 1 from public.memberships
    where user_id = auth.uid()
      and account_id = hint
      and role in ('owner', 'admin', 'coach')
  ) then
    return hint;
  end if;

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

  if v_account is null then
    raise exception 'No account with permission to add players';
  end if;

  return v_account;
end;
$$;

revoke execute on function public.resolve_writable_account(uuid) from public;
grant execute on function public.resolve_writable_account(uuid) to authenticated;

-- Re-point the single-athlete RPC at the shared helper. Behaviour is identical
-- to 20260812220000; only the account lookup moved out of the body.
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
  v_account := public.resolve_writable_account(nullif(payload->>'account_id', '')::uuid);

  insert into public.athletes (
    account_id, first_name, last_name, year_of_birth, guardian_name,
    guardian_email, guardian_phone, guardian_user_id, medical_info, about, avatar_url
  ) values (
    v_account,
    payload->>'first_name',
    payload->>'last_name',
    nullif(payload->>'year_of_birth', '')::int,
    nullif(payload->>'guardian_name', ''),
    nullif(payload->>'guardian_email', ''),
    nullif(payload->>'guardian_phone', ''),
    nullif(payload->>'guardian_user_id', '')::uuid,
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

-- Bulk twin. `players` is a jsonb array of the same per-athlete objects
-- create_athlete_for_caller takes (minus account_id, which is resolved once for
-- the whole batch). Ids come back in input order: they are generated up front in
-- the CTE and aggregated by ordinality, so callers can zip them against their
-- own array without relying on INSERT ... RETURNING row order.
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
      guardian_email, guardian_phone, guardian_user_id, medical_info, about, avatar_url
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
