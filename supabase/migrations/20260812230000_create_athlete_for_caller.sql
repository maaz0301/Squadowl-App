-- ============================================================================
-- Resolve the athlete's owning account server-side.
-- ----------------------------------------------------------------------------
-- The client sends account_id from SupabaseDataSource.ctx(), which caches it for
-- the JS process lifetime. When that cached id goes stale -- the account was
-- deleted/recreated server-side, or the membership behind it changed -- every
-- insert is rejected by athletes_insert's WITH CHECK with the opaque "new row
-- violates row-level security policy for table athletes", and stays rejected
-- until the app process restarts.
--
-- This RPC takes the client's account_id as a *hint*: it is used only when the
-- caller genuinely holds owner/admin/coach on it, and otherwise falls back to
-- the caller's own best staff account. Authorization is unchanged -- the same
-- roles athletes_insert accepts are still required, and a caller with no staff
-- membership is still refused. RLS stays enabled on the table.
-- ============================================================================

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
