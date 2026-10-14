-- Founder back office additions (all gated server-side, security definer):
--   admin roles        super_admin (full) and support (help users, no money, no deletes)
--   two-factor         is_founder()/is_founder_staff() honour an aal2 session; optional "require for all"
--   audit log          append-only: rows cannot be edited or deleted
--   club notes         private notes on a club
--   club feature flags per-club switches on top of the platform-wide feature blocks
--   app version policy minimum app version + message, so an old build can be forced to update
--   privacy            find a person, export everything held, erase, parental consent records, retention
--   discount codes     founding / partner / referral kinds and first-time-customer-only
--   broadcast audience who a founder message goes to, by plan, status and role

-- ---------------------------------------------------------------------------
-- 1. Audit log: new actions, then make it append-only
-- ---------------------------------------------------------------------------

alter table public.founder_audit_log drop constraint if exists founder_audit_log_action_check;
alter table public.founder_audit_log add constraint founder_audit_log_action_check check (action = any (array[
  'suspend', 'reactivate', 'create_org', 'update_access', 'impersonate_start', 'impersonate_end',
  'update_user_role', 'reset_password', 'resend_verification', 'ban_user', 'unban_user', 'delete_user',
  'create_announcement', 'end_announcement', 'broadcast_email', 'create_discount_code', 'update_discount_code',
  'refund_payment', 'change_subscription', 'cancel_subscription', 'resume_subscription', 'delete_support_ticket',
  'update_team', 'archive_team', 'unarchive_team', 'update_player', 'add_player_to_team', 'update_team_roster',
  'remove_player_from_team', 'update_season', 'archive_season', 'unarchive_season', 'add_season_event',
  'update_season_event', 'delete_season_event', 'update_tryout', 'archive_tryout', 'unarchive_tryout',
  'delete_tryout', 'restore_tryout', 'add_player_to_tryout', 'update_participant', 'remove_participant',
  'restore_participant', 'update_assessor', 'remove_assessor', 'update_evaluation', 'delete_evaluation',
  'update_platform_blocked_features', 'update_platform_blocked_plan_tiers', 'update_dummy_data_blocked_plan_tiers',
  'update_limits', 'merge_users', 'add_credit', 'set_billing_date',
  -- new in this migration
  'add_club_note', 'delete_club_note', 'update_club_features', 'add_staff', 'remove_staff', 'set_require_mfa',
  'export_person_data', 'erase_athlete', 'erase_family', 'record_consent', 'revoke_consent',
  'update_retention', 'run_retention', 'set_app_version_policy', 'broadcast_custom', 'update_discount_meta'
]::text[]));

create or replace function public.founder_audit_log_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'The audit log is append-only' using errcode = '42501';
  elsif tg_op = 'DELETE' then
    raise exception 'The audit log is append-only' using errcode = '42501';
  end if;
  -- UPDATE: the only change allowed is the foreign keys' own "on delete set null"
  -- (a deleted account or user), which blanks a link and touches nothing else.
  if new.id is distinct from old.id
     or new.action is distinct from old.action
     or new.actor_email is distinct from old.actor_email
     or new.account_name is distinct from old.account_name
     or new.reason is distinct from old.reason
     or new.details is distinct from old.details
     or new.created_at is distinct from old.created_at
     or (new.actor_id is not null and new.actor_id is distinct from old.actor_id)
     or (new.account_id is not null and new.account_id is distinct from old.account_id) then
    raise exception 'The audit log is append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists founder_audit_log_no_change on public.founder_audit_log;
create trigger founder_audit_log_no_change
  before update or delete on public.founder_audit_log
  for each row execute function public.founder_audit_log_append_only();

drop trigger if exists founder_audit_log_no_truncate on public.founder_audit_log;
create trigger founder_audit_log_no_truncate
  before truncate on public.founder_audit_log
  for each statement execute function public.founder_audit_log_append_only();

-- ---------------------------------------------------------------------------
-- 2. Admin roles and two-factor
-- ---------------------------------------------------------------------------

alter table public.platform_settings
  add column if not exists require_founder_mfa boolean not null default false,
  add column if not exists min_app_version text,
  add column if not exists app_update_message text,
  add column if not exists retention_years int,
  add column if not exists retention_auto boolean not null default false;

alter table public.platform_settings drop constraint if exists platform_settings_retention_years_valid;
alter table public.platform_settings add constraint platform_settings_retention_years_valid
  check (retention_years is null or retention_years between 1 and 25);
alter table public.platform_settings drop constraint if exists platform_settings_min_app_version_valid;
alter table public.platform_settings add constraint platform_settings_min_app_version_valid
  check (min_app_version is null or min_app_version ~ '^[0-9]+(\.[0-9]+){0,2}$');

create table if not exists public.founder_staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null check (role in ('super_admin', 'support')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.founder_staff enable row level security;
-- No policies: read and written only through the definer functions below.

-- The caller's admin role, ignoring two-factor. The console uses it to decide
-- whether to ask for a code; it grants nothing on its own.
create or replace function public.founder_staff_role()
returns text language sql stable security definer set search_path = public, auth as $$
  select case
    when exists (select 1 from auth.users u
                  where u.id = auth.uid() and lower(u.email) = 'founder@tryout.ca' and u.email_confirmed_at is not null)
      then 'super_admin'
    else (select s.role from public.founder_staff s
            join auth.users u on u.id = s.user_id
           where s.user_id = auth.uid() and u.email_confirmed_at is not null)
  end;
$$;
grant execute on function public.founder_staff_role() to authenticated;
revoke execute on function public.founder_staff_role() from anon, public;

-- Whether this session has satisfied two-factor. Someone who enrolled must
-- present a code (aal2); someone who never enrolled passes until the founder
-- turns on "require for all admin accounts".
create or replace function public.founder_mfa_ok()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or (
        not coalesce((select require_founder_mfa from public.platform_settings where id), false)
        and not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
      );
$$;
grant execute on function public.founder_mfa_ok() to authenticated;
revoke execute on function public.founder_mfa_ok() from anon, public;

create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select public.founder_staff_role() = 'super_admin' and public.founder_mfa_ok();
$$;

-- Any admin role (super admin or support).
create or replace function public.is_founder_staff()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select public.founder_staff_role() is not null and public.founder_mfa_ok();
$$;
grant execute on function public.is_founder_staff() to authenticated;
revoke execute on function public.is_founder_staff() from anon, public;

-- The role a signed-in, two-factor-cleared admin acts under.
create or replace function public.founder_role()
returns text language sql stable security definer set search_path = public, auth as $$
  select case when public.founder_mfa_ok() then public.founder_staff_role() end;
$$;
grant execute on function public.founder_role() to authenticated;
revoke execute on function public.founder_role() from anon, public;

create or replace function public.founder_list_staff()
returns table (user_id uuid, email text, role text, is_owner boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, 'super_admin'::text, true, u.created_at
      from auth.users u where lower(u.email) = 'founder@tryout.ca'
    union all
    select s.user_id, s.email, s.role, false, s.created_at from public.founder_staff s
    order by 4 desc, 5;
end;
$$;
grant execute on function public.founder_list_staff() to authenticated;
revoke execute on function public.founder_list_staff() from anon, public;

create or replace function public.founder_add_staff(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  v_user auth.users;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_role not in ('super_admin', 'support') then
    raise exception 'Role must be super_admin or support' using errcode = '22023';
  end if;
  select * into v_user from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if not found then
    raise exception 'No verified account uses %. Ask them to sign up and verify their email first.', v_email
      using errcode = 'P0002';
  end if;
  if v_email = 'founder@tryout.ca' then
    raise exception 'That account is already the owner' using errcode = '22023';
  end if;
  insert into public.founder_staff (user_id, email, role, created_by)
  values (v_user.id, v_user.email, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role;
  perform public.founder_write_audit('add_staff', null, null, null,
    jsonb_build_object('email', v_user.email, 'role', p_role));
end;
$$;
grant execute on function public.founder_add_staff(text, text) to authenticated;
revoke execute on function public.founder_add_staff(text, text) from anon, public;

create or replace function public.founder_remove_staff(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_email text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.founder_staff where user_id = p_user_id returning email into v_email;
  if v_email is null then
    raise exception 'That person is not an admin' using errcode = 'P0002';
  end if;
  perform public.founder_write_audit('remove_staff', null, null, null, jsonb_build_object('email', v_email));
end;
$$;
grant execute on function public.founder_remove_staff(uuid) to authenticated;
revoke execute on function public.founder_remove_staff(uuid) from anon, public;

-- Turning this on makes every admin account present a code. The caller must
-- already have one, or they would lock themselves out.
create or replace function public.founder_set_require_mfa(p_required boolean)
returns boolean language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_required and not (
       coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       and exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
     ) then
    raise exception 'Set up two-factor on your own account and sign in with a code first' using errcode = '22023';
  end if;
  update public.platform_settings set require_founder_mfa = p_required, updated_at = now() where id;
  perform public.founder_write_audit('set_require_mfa', null, 'Platform', null, jsonb_build_object('required', p_required));
  return p_required;
end;
$$;
grant execute on function public.founder_set_require_mfa(boolean) to authenticated;
revoke execute on function public.founder_set_require_mfa(boolean) from anon, public;

create or replace function public.founder_security_settings()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  -- Deliberately not behind two-factor: the console reads this to decide whether
  -- to ask for a code or for enrollment.
  if public.founder_staff_role() is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'requireMfa', coalesce((select require_founder_mfa from public.platform_settings where id), false),
    'role', public.founder_staff_role());
end;
$$;
grant execute on function public.founder_security_settings() to authenticated;
revoke execute on function public.founder_security_settings() from anon, public;

-- Support may read and work these; everything else stays super-admin only. The
-- bodies are re-created with the staff check so each function's own logic is
-- untouched.
do $$
declare
  f record;
  d text;
  swapped text;
begin
  for f in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'founder_list_organizations', 'founder_list_users', 'founder_log_user_action',
         'founder_create_support_ticket', 'founder_add_support_message', 'founder_set_support_ticket_status'])
  loop
    d := pg_get_functiondef(f.oid);
    swapped := regexp_replace(d, '(public\.)?is_founder\(\)', 'public.is_founder_staff()', 'g');
    if swapped = d then
      raise notice 'founder_back_office: % has no is_founder() check to swap', f.proname;
    else
      execute swapped;
    end if;
  end loop;
end $$;

drop policy if exists support_tickets_founder_read on public.support_tickets;
create policy support_tickets_founder_read on public.support_tickets
  for select using (public.is_founder_staff());
drop policy if exists support_messages_founder_read on public.support_messages;
create policy support_messages_founder_read on public.support_messages
  for select using (public.is_founder_staff());

-- ---------------------------------------------------------------------------
-- 3. Private notes on a club
-- ---------------------------------------------------------------------------

create table if not exists public.founder_club_notes (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  body         text not null check (length(trim(body)) between 1 and 4000),
  pinned       boolean not null default false,
  author_id    uuid references auth.users(id) on delete set null,
  author_email text,
  created_at   timestamptz not null default now()
);
create index if not exists founder_club_notes_account_idx on public.founder_club_notes (account_id, created_at desc);
alter table public.founder_club_notes enable row level security;

create or replace function public.founder_list_club_notes(p_account_id uuid)
returns table (id uuid, body text, pinned boolean, author_email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_founder_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select n.id, n.body, n.pinned, n.author_email, n.created_at
      from public.founder_club_notes n
     where n.account_id = p_account_id
     order by n.pinned desc, n.created_at desc;
end;
$$;

create or replace function public.founder_add_club_note(p_account_id uuid, p_body text, p_pinned boolean default false)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  v_id uuid;
  v_name text;
begin
  if not public.is_founder_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select name into v_name from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  insert into public.founder_club_notes (account_id, body, pinned, author_id, author_email)
  values (p_account_id, trim(p_body), coalesce(p_pinned, false), auth.uid(), (select email from auth.users where id = auth.uid()))
  returning id into v_id;
  perform public.founder_write_audit('add_club_note', p_account_id, v_name, null, '{}'::jsonb);
  return v_id;
end;
$$;

create or replace function public.founder_delete_club_note(p_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  v_account uuid;
  v_name text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.founder_club_notes where id = p_id returning account_id into v_account;
  if v_account is null then
    raise exception 'Note not found' using errcode = 'P0002';
  end if;
  select name into v_name from public.accounts where id = v_account;
  perform public.founder_write_audit('delete_club_note', v_account, v_name, null, '{}'::jsonb);
end;
$$;

grant execute on function public.founder_list_club_notes(uuid) to authenticated;
grant execute on function public.founder_add_club_note(uuid, text, boolean) to authenticated;
grant execute on function public.founder_delete_club_note(uuid) to authenticated;
revoke execute on function public.founder_list_club_notes(uuid) from anon, public;
revoke execute on function public.founder_add_club_note(uuid, text, boolean) from anon, public;
revoke execute on function public.founder_delete_club_note(uuid) from anon, public;

-- ---------------------------------------------------------------------------
-- 4. Per-club feature flags (on top of platform_settings.blocked_features)
-- ---------------------------------------------------------------------------

alter table public.accounts add column if not exists blocked_features text[] not null default '{}';
alter table public.accounts drop constraint if exists accounts_blocked_features_valid;
alter table public.accounts add constraint accounts_blocked_features_valid check (blocked_features <@ array[
  'evaluations', 'teams', 'dashboard', 'profile', 'myAthletes', 'organization', 'loyalty', 'billing'
]::text[]);

create or replace function public.founder_set_club_blocked_features(p_account_id uuid, p_blocked_features text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_before text[];
  v_next text[];
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select name, blocked_features into v_name, v_before from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(distinct f order by f), array[]::text[]) into v_next
    from unnest(coalesce(p_blocked_features, array[]::text[])) f;
  if v_next = v_before then
    return v_before;
  end if;
  update public.accounts set blocked_features = v_next where id = p_account_id;
  perform public.founder_write_audit('update_club_features', p_account_id, v_name, null,
    jsonb_build_object('before', v_before, 'after', v_next));
  return v_next;
end;
$$;
grant execute on function public.founder_set_club_blocked_features(uuid, text[]) to authenticated;
revoke execute on function public.founder_set_club_blocked_features(uuid, text[]) from anon, public;

-- ---------------------------------------------------------------------------
-- 5. App version policy
-- ---------------------------------------------------------------------------

create or replace function public.app_version_policy()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('minVersion', s.min_app_version, 'message', s.app_update_message)
    from public.platform_settings s where s.id;
$$;
grant execute on function public.app_version_policy() to authenticated, anon;

create or replace function public.founder_set_app_version_policy(p_min_version text, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_min text := nullif(trim(coalesce(p_min_version, '')), '');
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.platform_settings
     set min_app_version = v_min, app_update_message = nullif(trim(coalesce(p_message, '')), ''), updated_at = now()
   where id;
  perform public.founder_write_audit('set_app_version_policy', null, 'Platform', null,
    jsonb_build_object('minVersion', v_min));
  return public.app_version_policy();
end;
$$;
grant execute on function public.founder_set_app_version_policy(text, text) to authenticated;
revoke execute on function public.founder_set_app_version_policy(text, text) from anon, public;

-- ---------------------------------------------------------------------------
-- 6. Privacy and compliance
-- ---------------------------------------------------------------------------

-- Proof that a parent agreed. athlete_id is nulled (not cascaded) and the row
-- scrubbed when the athlete is erased, so the fact of consent outlives the data.
create table if not exists public.parental_consents (
  id             uuid primary key default gen_random_uuid(),
  athlete_id     uuid references public.athletes(id) on delete set null,
  athlete_name   text,
  guardian_name  text,
  guardian_email text,
  consent_type   text not null check (consent_type in ('data_collection', 'photo_video', 'communications', 'third_party_sharing')),
  source         text not null default 'other' check (source in ('registration', 'portal', 'paper', 'email', 'other')),
  notes          text,
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  erased_at      timestamptz,
  recorded_by    uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists parental_consents_athlete_idx on public.parental_consents (athlete_id);
alter table public.parental_consents enable row level security;

create or replace function public.founder_search_people(p_query text)
returns table (
  athlete_id uuid, first_name text, last_name text, year_of_birth int,
  guardian_name text, guardian_email text, account_id uuid, account_name text, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || replace(replace(trim(coalesce(p_query, '')), '%', ''), '_', '') || '%';
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_query, ''))) < 2 then
    return;
  end if;
  return query
    select a.id, a.first_name, a.last_name, a.year_of_birth, a.guardian_name, a.guardian_email::text,
           a.account_id, ac.name, a.created_at
      from public.athletes a
      join public.accounts ac on ac.id = a.account_id
     where not ac.hidden_from_founder
       and (a.first_name || ' ' || a.last_name ilike q
         or a.guardian_name ilike q
         or a.guardian_email::text ilike q)
     order by a.last_name, a.first_name
     limit 50;
end;
$$;

create or replace function public.founder_list_consents(p_athlete_id uuid default null)
returns table (
  id uuid, athlete_id uuid, athlete_name text, guardian_name text, guardian_email text, consent_type text,
  source text, notes text, granted_at timestamptz, revoked_at timestamptz, erased_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select c.id, c.athlete_id, c.athlete_name, c.guardian_name, c.guardian_email, c.consent_type,
           c.source, c.notes, c.granted_at, c.revoked_at, c.erased_at
      from public.parental_consents c
     where p_athlete_id is null or c.athlete_id = p_athlete_id
     order by c.granted_at desc
     limit 500;
end;
$$;

create or replace function public.founder_record_consent(
  p_athlete_id uuid, p_consent_type text, p_source text, p_notes text, p_granted_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  a public.athletes;
  v_id uuid;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into a from public.athletes where id = p_athlete_id;
  if not found then
    raise exception 'Athlete not found' using errcode = 'P0002';
  end if;
  insert into public.parental_consents
    (athlete_id, athlete_name, guardian_name, guardian_email, consent_type, source, notes, granted_at, recorded_by)
  values
    (a.id, a.first_name || ' ' || a.last_name, a.guardian_name, a.guardian_email::text, p_consent_type,
     coalesce(nullif(p_source, ''), 'other'), nullif(trim(coalesce(p_notes, '')), ''),
     coalesce(p_granted_at, now()), auth.uid())
  returning id into v_id;
  perform public.founder_write_audit('record_consent', a.account_id, null, null,
    jsonb_build_object('athlete_id', a.id, 'consent_type', p_consent_type));
  return v_id;
end;
$$;

create or replace function public.founder_revoke_consent(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.parental_consents;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.parental_consents set revoked_at = now()
   where id = p_id and revoked_at is null and erased_at is null
   returning * into c;
  if not found then
    raise exception 'Consent not found or already revoked' using errcode = 'P0002';
  end if;
  perform public.founder_write_audit('revoke_consent', null, null, null,
    jsonb_build_object('consent_id', p_id, 'consent_type', c.consent_type));
end;
$$;

-- Everything the platform holds on one athlete, as one document.
create or replace function public.founder_export_person_data(p_athlete_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.athletes;
  v jsonb;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into a from public.athletes where id = p_athlete_id;
  if not found then
    raise exception 'Athlete not found' using errcode = 'P0002';
  end if;

  v := jsonb_build_object(
    'exportedAt', now(),
    'athlete', to_jsonb(a),
    'organization', (select name from public.accounts where id = a.account_id),
    'familyContacts', coalesce((select jsonb_agg(to_jsonb(x)) from public.athlete_family_contacts x where x.athlete_id = a.id), '[]'::jsonb),
    'teamRoster', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('teamName', t.name))
                              from public.team_roster x join public.teams t on t.id = x.team_id
                             where x.athlete_id = a.id), '[]'::jsonb),
    'seasonRoster', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('seasonName', s.name))
                                from public.season_roster x join public.seasons s on s.id = x.season_id
                               where x.athlete_id = a.id), '[]'::jsonb),
    'evaluationParticipation', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('evaluationName', t.name, 'evaluationDate', t.tryout_date))
                                           from public.tryout_participants x join public.tryouts t on t.id = x.tryout_id
                                          where x.athlete_id = a.id), '[]'::jsonb),
    'evaluations', coalesce((select jsonb_agg(to_jsonb(e))
                               from public.evaluations e
                               join public.tryout_participants tp on tp.id = e.participant_id
                              where tp.athlete_id = a.id), '[]'::jsonb),
    'registrations', coalesce((select jsonb_agg(to_jsonb(x)) from public.registrations x where x.athlete_id = a.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(x)) from public.payments x where x.athlete_id = a.id), '[]'::jsonb),
    'reportCards', coalesce((select jsonb_agg(to_jsonb(x)) from public.player_report_cards x where x.athlete_id = a.id), '[]'::jsonb),
    'letters', coalesce((select jsonb_agg(to_jsonb(x)) from public.player_letters x where x.athlete_id = a.id), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(to_jsonb(x)) from public.parental_consents x where x.athlete_id = a.id), '[]'::jsonb)
  );

  perform public.founder_write_audit('export_person_data', a.account_id, null, null,
    jsonb_build_object('athlete_id', a.id, 'athlete_name', a.first_name || ' ' || a.last_name));
  return v;
end;
$$;

-- Permanently removes one athlete and what hangs off them. Payment records are
-- kept (financial record-keeping) but lose their link to the athlete.
create or replace function public.erase_athlete_internal(p_athlete_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.parental_consents
     set athlete_name = 'Erased', guardian_name = null, guardian_email = null, notes = null, erased_at = now()
   where athlete_id = p_athlete_id;
  delete from public.registrations where athlete_id = p_athlete_id;
  delete from public.player_letters where athlete_id = p_athlete_id;
  delete from public.athletes where id = p_athlete_id;
end;
$$;
revoke all on function public.erase_athlete_internal(uuid) from public, anon, authenticated;

create or replace function public.founder_erase_athlete(p_athlete_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.athletes;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select * into a from public.athletes where id = p_athlete_id;
  if not found then
    raise exception 'Athlete not found' using errcode = 'P0002';
  end if;
  -- Logged first, in the same transaction, so the record survives the erase.
  perform public.founder_write_audit('erase_athlete', a.account_id, null, p_reason,
    jsonb_build_object('athlete_id', a.id, 'athlete_name', a.first_name || ' ' || a.last_name));
  perform public.erase_athlete_internal(a.id);
end;
$$;

-- Every athlete a guardian email is attached to (a whole family at once).
create or replace function public.founder_erase_family(p_guardian_email text, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare
  a record;
  n int := 0;
  v_email text := lower(trim(coalesce(p_guardian_email, '')));
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if v_email = '' then
    raise exception 'A guardian email is required' using errcode = '22023';
  end if;
  for a in select id, account_id, first_name, last_name from public.athletes where lower(guardian_email::text) = v_email loop
    perform public.founder_write_audit('erase_family', a.account_id, null, p_reason,
      jsonb_build_object('athlete_id', a.id, 'athlete_name', a.first_name || ' ' || a.last_name));
    perform public.erase_athlete_internal(a.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Athletes with nothing happening for N years: not on a live team, not in a
-- recent evaluation or season, not edited.
create or replace function public.retention_candidates(p_years int)
returns table (athlete_id uuid, athlete_name text, account_name text, last_activity timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.first_name || ' ' || a.last_name, ac.name, x.last_activity
    from public.athletes a
    join public.accounts ac on ac.id = a.account_id
    cross join lateral (
      select greatest(
        a.updated_at,
        coalesce((select max(t.tryout_date)::timestamptz
                    from public.tryout_participants tp join public.tryouts t on t.id = tp.tryout_id
                   where tp.athlete_id = a.id), a.updated_at),
        coalesce((select max(s.created_at)
                    from public.season_roster sr join public.seasons s on s.id = sr.season_id
                   where sr.athlete_id = a.id), a.updated_at)
      ) as last_activity
    ) x
   where x.last_activity < now() - make_interval(years => p_years)
     and not exists (select 1 from public.team_roster tr join public.teams te on te.id = tr.team_id
                      where tr.athlete_id = a.id and not te.archived);
$$;
revoke all on function public.retention_candidates(int) from public, anon, authenticated;

create or replace function public.founder_get_retention()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.platform_settings;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into s from public.platform_settings where id;
  return jsonb_build_object(
    'years', s.retention_years,
    'auto', s.retention_auto,
    'dueCount', case when s.retention_years is null then 0
                     else (select count(*) from public.retention_candidates(s.retention_years)) end);
end;
$$;

create or replace function public.founder_set_retention(p_years int, p_auto boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_years is not null and p_years not between 1 and 25 then
    raise exception 'Retention must be between 1 and 25 years' using errcode = '22023';
  end if;
  update public.platform_settings
     set retention_years = p_years, retention_auto = (p_years is not null and coalesce(p_auto, false)), updated_at = now()
   where id;
  perform public.founder_write_audit('update_retention', null, 'Platform', null,
    jsonb_build_object('years', p_years, 'auto', p_years is not null and coalesce(p_auto, false)));
  return public.founder_get_retention();
end;
$$;

create or replace function public.founder_retention_preview(p_limit int default 200)
returns table (athlete_id uuid, athlete_name text, account_name text, last_activity timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_years int;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select retention_years into v_years from public.platform_settings where id;
  if v_years is null then
    return;
  end if;
  return query
    select c.athlete_id, c.athlete_name, c.account_name, c.last_activity
      from public.retention_candidates(v_years) c
     order by c.last_activity
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

create or replace function public.run_retention_internal(p_actor text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_years int;
  c record;
  n int := 0;
begin
  select retention_years into v_years from public.platform_settings where id;
  if v_years is null then
    return 0;
  end if;
  for c in select * from public.retention_candidates(v_years) loop
    perform public.erase_athlete_internal(c.athlete_id);
    n := n + 1;
  end loop;
  if n > 0 then
    insert into public.founder_audit_log (actor_id, actor_email, action, account_name, reason, details)
    values (auth.uid(), p_actor, 'run_retention', 'Platform', 'Retention rule',
            jsonb_build_object('years', v_years, 'athletes_removed', n));
  end if;
  return n;
end;
$$;
revoke all on function public.run_retention_internal(text) from public, anon, authenticated;

create or replace function public.founder_run_retention()
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return public.run_retention_internal((select email from auth.users where id = auth.uid()));
end;
$$;

-- Nightly pass, but only when the founder switched "run automatically" on.
create or replace function public.retention_cron_job()
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select retention_auto from public.platform_settings where id), false) then
    perform public.run_retention_internal('retention-schedule');
  end if;
end;
$$;
revoke all on function public.retention_cron_job() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('founder-retention', '15 3 * * *', 'select public.retention_cron_job()');
  else
    raise notice 'founder_back_office: pg_cron is not installed, so the retention rule only runs from the console';
  end if;
exception when others then
  raise notice 'founder_back_office: could not schedule the retention job (%)', sqlerrm;
end $$;

grant execute on function public.founder_search_people(text) to authenticated;
grant execute on function public.founder_list_consents(uuid) to authenticated;
grant execute on function public.founder_record_consent(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.founder_revoke_consent(uuid) to authenticated;
grant execute on function public.founder_export_person_data(uuid) to authenticated;
grant execute on function public.founder_erase_athlete(uuid, text) to authenticated;
grant execute on function public.founder_erase_family(text, text) to authenticated;
grant execute on function public.founder_get_retention() to authenticated;
grant execute on function public.founder_set_retention(int, boolean) to authenticated;
grant execute on function public.founder_retention_preview(int) to authenticated;
grant execute on function public.founder_run_retention() to authenticated;
revoke execute on function public.founder_search_people(text) from anon, public;
revoke execute on function public.founder_list_consents(uuid) from anon, public;
revoke execute on function public.founder_record_consent(uuid, text, text, text, timestamptz) from anon, public;
revoke execute on function public.founder_revoke_consent(uuid) from anon, public;
revoke execute on function public.founder_export_person_data(uuid) from anon, public;
revoke execute on function public.founder_erase_athlete(uuid, text) from anon, public;
revoke execute on function public.founder_erase_family(text, text) from anon, public;
revoke execute on function public.founder_get_retention() from anon, public;
revoke execute on function public.founder_set_retention(int, boolean) from anon, public;
revoke execute on function public.founder_retention_preview(int) from anon, public;
revoke execute on function public.founder_run_retention() from anon, public;

-- ---------------------------------------------------------------------------
-- 7. Discount code kinds and first-time-customer rule
-- ---------------------------------------------------------------------------

alter table public.discount_codes
  add column if not exists category text not null default 'standard',
  add column if not exists partner_name text,
  add column if not exists first_time_only boolean not null default false;
alter table public.discount_codes drop constraint if exists discount_codes_category_valid;
alter table public.discount_codes add constraint discount_codes_category_valid
  check (category in ('standard', 'founding', 'partner', 'referral'));

create or replace function public.founder_discount_code_meta()
returns table (id uuid, category text, partner_name text, first_time_only boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query select d.id, d.category, d.partner_name, d.first_time_only from public.discount_codes d;
end;
$$;

create or replace function public.founder_set_discount_code_meta(
  p_id uuid, p_category text, p_partner_name text, p_first_time_only boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_category not in ('standard', 'founding', 'partner', 'referral') then
    raise exception 'Unknown code type' using errcode = '22023';
  end if;
  update public.discount_codes
     set category = p_category,
         partner_name = case when p_category = 'partner' then nullif(trim(coalesce(p_partner_name, '')), '') end,
         first_time_only = coalesce(p_first_time_only, false),
         updated_at = now()
   where id = p_id returning code into v_code;
  if v_code is null then
    raise exception 'Code not found' using errcode = 'P0002';
  end if;
  perform public.founder_write_audit('update_discount_meta', null, v_code, null,
    jsonb_build_object('category', p_category, 'first_time_only', coalesce(p_first_time_only, false)));
end;
$$;
grant execute on function public.founder_discount_code_meta() to authenticated;
grant execute on function public.founder_set_discount_code_meta(uuid, text, text, boolean) to authenticated;
revoke execute on function public.founder_discount_code_meta() from anon, public;
revoke execute on function public.founder_set_discount_code_meta(uuid, text, text, boolean) from anon, public;

-- check_discount_code gains the first-time rule: an organization that has ever
-- subscribed, or ever redeemed any code, is not a first-time customer.
create or replace function public.check_discount_code(p_code text, p_plan_tier text, p_account_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  d public.discount_codes;
  v_uses int;
  v_account_uses int;
begin
  select * into d from public.discount_codes where code = upper(trim(coalesce(p_code, '')));
  if not found or not d.active then
    return json_build_object('valid', false, 'message', 'That discount code isn''t valid.');
  end if;
  if d.expires_at is not null and d.expires_at <= now() then
    return json_build_object('valid', false, 'message', 'That discount code has expired.');
  end if;
  if d.plan_tiers is not null and not (coalesce(p_plan_tier, '') = any(d.plan_tiers)) then
    return json_build_object('valid', false, 'message', 'That discount code doesn''t apply to this purchase.');
  end if;
  -- Storage only takes codes made for it.
  if p_plan_tier = 'video_storage' and d.plan_tiers is null then
    return json_build_object('valid', false, 'message', 'That discount code doesn''t apply to video storage.');
  end if;

  select count(*), count(*) filter (where account_id = p_account_id)
    into v_uses, v_account_uses
    from public.discount_code_redemptions
   where code_id = d.id;

  if d.max_uses is not null and v_uses >= d.max_uses then
    return json_build_object('valid', false, 'message', 'That discount code has been fully redeemed.');
  end if;
  if d.max_uses_per_account is not null and p_account_id is not null and v_account_uses >= d.max_uses_per_account then
    return json_build_object('valid', false, 'message', 'Your organization has already used that discount code.');
  end if;

  if d.first_time_only and p_account_id is not null and (
       exists (select 1 from public.discount_code_redemptions r where r.account_id = p_account_id)
       or exists (select 1 from public.accounts a where a.id = p_account_id and a.stripe_subscription_id is not null)
     ) then
    return json_build_object('valid', false, 'message', 'That discount code is for first-time customers only.');
  end if;

  return json_build_object(
    'valid', true,
    'id', d.id,
    'code', d.code,
    'kind', d.kind,
    'percentOff', d.percent_off,
    'amountOffCents', d.amount_off_cents,
    'duration', d.duration,
    'durationMonths', d.duration_months,
    'planTiers', d.plan_tiers);
end;
$$;
revoke all on function public.check_discount_code(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Broadcast audience (service role only; the founder-support function calls it)
-- ---------------------------------------------------------------------------

create or replace function public.founder_audience(
  p_plan_tiers text[] default null,
  p_access_statuses text[] default null,
  p_roles text[] default null
) returns table (user_id uuid, email text, account_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (p.id) p.id, lower(p.email::text), a.id
    from public.memberships m
    join public.accounts a on a.id = m.account_id
    join public.profiles p on p.id = m.user_id
   where not a.hidden_from_founder
     and p.email is not null
     and m.role::text = any (coalesce(nullif(p_roles, '{}'), array['owner', 'admin']))
     and (p_plan_tiers is null or cardinality(p_plan_tiers) = 0 or a.plan_tier::text = any (p_plan_tiers))
     and (p_access_statuses is null or cardinality(p_access_statuses) = 0
          or public.account_access_status(a)::text = any (p_access_statuses))
   order by p.id;
$$;
revoke all on function public.founder_audience(text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.founder_audience(text[], text[], text[]) to service_role;
