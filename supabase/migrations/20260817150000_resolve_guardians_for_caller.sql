-- ============================================================================
-- Bulk guardian resolution for the bulk registration-placement path.
-- ----------------------------------------------------------------------------
-- addRegistrationsToRoster/addRegistrationsToTeam place registrations in
-- chunks of 20, and until now each registration's guardian was resolved with
-- its own check_user_exists / create_user_with_password / get_user_id_by_email
-- round trip (1-3 requests per registration, at a concurrency cap of 10). For
-- a 1000-player selection that's the dominant cost of "Add to Roster" being
-- slow: on the order of a hundred sequential waves of round trips before the
-- first athlete row is even inserted.
--
-- This adds the bulk twin: one round trip resolves (and creates, where
-- needed) every distinct guardian email in a whole chunk. Behaviour mirrors
-- create_user_with_password(email, password, display_name, account_type) from
-- 0016 — same authorization check, same auto-confirmed account_type-tagged
-- account for a new guardian, same "leave alone" handling for one that already
-- exists — just batched, and with a per-guardian exception handler so one bad
-- email (or a duplicate-key race against a concurrent chunk) can't fail the
-- rest of the chunk's athletes the way an unhandled error in a single bulk
-- INSERT would.
-- ============================================================================

create or replace function public.resolve_guardians_for_caller(guardians jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item jsonb;
  v_email text;
  v_email_lc text;
  v_display_name text;
  v_user_id uuid;
  v_password text;
  v_created boolean;
  v_seen jsonb := '{}'::jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from public.memberships
    where user_id = auth.uid() and role in ('owner', 'admin', 'coach')
  ) and not public.is_platform_admin() then
    raise exception 'Not authorized to create user accounts';
  end if;

  if guardians is null or jsonb_typeof(guardians) <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_item in select * from jsonb_array_elements(guardians)
  loop
    v_email := v_item->>'email';
    if v_email is null or v_email = '' then
      continue;
    end if;
    v_email_lc := lower(v_email);
    v_display_name := coalesce(v_item->>'display_name', 'Guardian');
    v_created := false;
    v_password := null;

    if v_seen ? v_email_lc then
      -- Same guardian already resolved earlier in this batch (siblings).
      v_user_id := nullif(v_seen->>v_email_lc, '')::uuid;
    else
      select id into v_user_id from auth.users where lower(email) = v_email_lc limit 1;

      if v_user_id is null then
        begin
          v_user_id := gen_random_uuid();
          v_password := substr(replace(replace(encode(gen_random_bytes(9), 'base64'), '/', '_'), '+', '-'), 1, 12) || 'Aa1!';

          insert into auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
          ) values (
            '00000000-0000-0000-0000-000000000000',
            v_user_id, 'authenticated', 'authenticated', v_email,
            extensions.crypt(v_password, extensions.gen_salt('bf')),
            now(),
            '{"provider": "email", "providers": ["email"]}',
            jsonb_build_object('display_name', v_display_name, 'account_type', 'guardian'),
            now(), now(), ''
          );

          insert into auth.identities (
            id, user_id, provider_id, identity_data, provider, created_at, updated_at
          ) values (
            gen_random_uuid(), v_user_id, v_user_id::text,
            jsonb_build_object('sub', v_user_id::text, 'email', v_email),
            'email', now(), now()
          );

          v_created := true;
        exception
          when unique_violation then
            -- Lost a race with a concurrent chunk creating the same email.
            v_password := null;
            select id into v_user_id from auth.users where lower(email) = v_email_lc limit 1;
          when others then
            v_user_id := null;
            v_password := null;
        end;
      end if;

      v_seen := v_seen || jsonb_build_object(v_email_lc, coalesce(v_user_id::text, ''));
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'email', v_email,
      'user_id', v_user_id,
      'created', v_created,
      'password', v_password
    ));
  end loop;

  return v_result;
end;
$$;

revoke execute on function public.resolve_guardians_for_caller(jsonb) from public;
grant execute on function public.resolve_guardians_for_caller(jsonb) to authenticated;
