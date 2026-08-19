-- ============================================================================
-- Fix: invite_team_manager_by_email — "no unique or exclusion constraint
-- matching the ON CONFLICT specification"
-- ----------------------------------------------------------------------------
-- The function shipped in 20260818120000_team_managers.sql used
-- `on conflict (team_id, user_id) do update ...`, which requires Postgres to
-- find an actual unique/exclusion constraint (or index) on exactly those
-- columns. team_managers was created with `unique (team_id, user_id)` inline,
-- which should produce one — but on this project the table ended up without
-- it (table pre-dated the constraint, or the create-table transaction only
-- partially landed), so every invite failed with that error in the UI.
--
-- Two independent fixes, so this can't recur even if the constraint again
-- goes missing for some unrelated reason:
--   1. Add the constraint back if it isn't there.
--   2. Rewrite the RPC to check-then-insert/update instead of ON CONFLICT, so
--      it no longer depends on that constraint existing at all.
-- ============================================================================

do $$
declare
  col record;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.team_managers'::regclass
      and contype = 'u'
  ) then
    alter table public.team_managers
      add constraint team_managers_team_id_user_id_key unique (team_id, user_id);
  end if;

  -- If legacy columns (such as email) pre-existed on team_managers with NOT NULL,
  -- drop the constraint so new inserts without legacy fields succeed.
  for col in (
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'team_managers'
      and is_nullable = 'NO'
      and column_default is null
      and column_name not in ('id', 'team_id', 'user_id')
  ) loop
    execute format('alter table public.team_managers alter column %I drop not null', col.column_name);
  end loop;
end $$;

create or replace function public.invite_team_manager_by_email(
  team_uuid    uuid,
  lookup_email text,
  manager_role text default 'manager'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  target_name    text;
  target_email   text;
  new_id         uuid;
begin
  if not public.can_delegate_team(team_uuid) then
    raise exception 'Not authorized to delegate this team';
  end if;

  select id, display_name, email
    into target_user_id, target_name, target_email
  from public.profiles
  where lower(email) = lower(btrim(lookup_email));

  if target_user_id is null then
    raise exception 'User not found';
  end if;

  if exists (
    select 1 from public.teams te
    join public.memberships m on m.account_id = te.account_id
    where te.id = team_uuid
      and m.user_id = target_user_id
      and m.role = any (array['owner','admin','coach']::membership_role[])
  ) then
    raise exception 'That person is already staff on this account and can manage every team';
  end if;

  -- Check-then-insert/update rather than `on conflict`: this is called at most
  -- once per invite click, so the tiny TOCTOU window is an acceptable trade for
  -- not depending on a DB-level constraint that has already gone missing once.
  select id into new_id
  from public.team_managers
  where team_id = team_uuid and user_id = target_user_id;

  if new_id is not null then
    update public.team_managers
    set role = manager_role::team_manager_role
    where id = new_id;
  else
    insert into public.team_managers (team_id, user_id, role, invited_by)
    values (team_uuid, target_user_id, manager_role::team_manager_role, auth.uid())
    returning id into new_id;
  end if;

  return json_build_object(
    'id',     new_id,
    'teamId', team_uuid,
    'userId', target_user_id,
    'role',   manager_role,
    'email',  target_email,
    'name',   target_name
  );
end;
$$;

grant execute on function public.invite_team_manager_by_email(uuid, text, text) to authenticated;
