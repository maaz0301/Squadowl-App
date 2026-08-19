-- ============================================================================
-- Delegated per-team management (CLUB mode)
-- ----------------------------------------------------------------------------
-- A club owner/admin can hand one specific team to another coach or manager by
-- email. Until now the only way to give someone write access was a memberships
-- row, which is account-wide: inviting a coach to run the U13 team also handed
-- them every other team, athlete, and assessment on the club's account.
--
-- team_managers is a second, narrower access path. It never replaces the
-- account membership check — every predicate below is `existing OR team
-- manager` — so the club's own staff keep full access to a delegated team
-- (explicitly required: "the CLUB manager still has access to the team").
--
-- Delegates are deliberately NOT given account-level rights: they cannot see
-- the club's other teams, its billing, or its org member list. Their reach is
-- the team, its roster, its seasons/schedule/chat, and the athletes on it.
-- ============================================================================

do $$ begin
  create type team_manager_role as enum ('manager', 'coach');
exception when duplicate_object then null;
end $$;

create table if not exists public.team_managers (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       team_manager_role not null default 'manager',
  -- Kept for the audit trail ("who handed this team out"); nulled rather than
  -- cascaded so removing the inviting staff member doesn't revoke the delegate.
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create index if not exists idx_team_managers_team on public.team_managers(team_id);
create index if not exists idx_team_managers_user on public.team_managers(user_id);

do $$
declare
  col record;
begin
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

-- ----------------------------------------------------------------------------
-- Access predicates
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER matters here beyond the usual convenience: this function is
-- called from the team_managers policies themselves, and a non-definer version
-- would re-enter those policies and recurse.
create or replace function public.is_team_manager(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_managers tm
    where tm.team_id = t and tm.user_id = auth.uid()
  );
$$;

-- Account staff on the team's own account, OR a delegated manager of it.
create or replace function public.can_manage_team(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams te where te.id = t
      and public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[])
  ) or public.is_team_manager(t);
$$;

-- Only account staff may hand out or revoke a delegation — a delegate cannot
-- pass the team on to someone else.
create or replace function public.can_delegate_team(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams te where te.id = t
      and public.has_account_role(te.account_id, array['owner','admin']::membership_role[])
  );
$$;

alter table public.team_managers enable row level security;

-- A delegate can see their own delegation row (that's how the client learns the
-- team is theirs); staff on the owning account see every delegation on it.
drop policy if exists team_managers_read on public.team_managers;
create policy team_managers_read on public.team_managers
  for select using (user_id = auth.uid() or public.can_delegate_team(team_id));

-- Writes go through the RPCs below, which resolve emails to users, but the
-- policy is stated anyway so a direct write can't bypass the owner/admin gate.
drop policy if exists team_managers_write on public.team_managers;
create policy team_managers_write on public.team_managers
  for all using (public.can_delegate_team(team_id))
  with check (public.can_delegate_team(team_id));

-- ----------------------------------------------------------------------------
-- Widen the shared predicates so a delegated team behaves like a real team
-- ----------------------------------------------------------------------------
-- Both redefinitions are pure supersets: every input that was TRUE before is
-- still TRUE. Extending these two rather than bolting a policy onto each table
-- is what makes the delegation reach season_events, season_roster,
-- season_messages (team chat), and evaluations without touching them — they all
-- already gate on can_access_season / can_access_athlete.

-- Account staff, a guardian on the roster, OR a manager of the season's team.
create or replace function public.can_access_season(s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.seasons se where se.id = s and (
      public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
      or (se.team_id is not null and public.is_team_manager(se.team_id))
      or exists (
        select 1 from public.season_roster sr
        join public.athletes at on at.id = sr.athlete_id
        where sr.season_id = s and at.guardian_user_id = auth.uid()
      )
    )
  );
$$;

-- ...plus an athlete on a delegated team's roster (directly, or via one of that
-- team's season rosters), so names/details actually resolve for the delegate.
create or replace function public.can_access_athlete(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
      or at.guardian_user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.tryout_participants tp
    join public.tryout_assessors ta on ta.tryout_id = tp.tryout_id
    where tp.athlete_id = a and ta.user_id = auth.uid()
  )
  or public.has_athlete_account_access(a)
  or exists (
    select 1 from public.team_roster tr
    where tr.athlete_id = a and public.is_team_manager(tr.team_id)
  )
  or exists (
    select 1 from public.season_roster sr
    join public.seasons se on se.id = sr.season_id
    where sr.athlete_id = a
      and se.team_id is not null
      and public.is_team_manager(se.team_id)
  );
$$;

-- ----------------------------------------------------------------------------
-- Per-table policies for the paths the predicates above don't cover
-- ----------------------------------------------------------------------------
-- RLS ORs permissive policies together, so each of these only ever adds access;
-- the existing account-scoped policies are left exactly as they are.

-- teams: read + edit the delegated team (rename, logo, colours, fee settings).
-- Deliberately no delete — a delegate cannot destroy the club's team.
drop policy if exists teams_manager_read on public.teams;
create policy teams_manager_read on public.teams
  for select using (public.is_team_manager(id));
drop policy if exists teams_manager_update on public.teams;
create policy teams_manager_update on public.teams
  for update using (public.is_team_manager(id))
  with check (public.is_team_manager(id));

-- team_roster: team_roster_read/-_write both gate on the owning account.
drop policy if exists team_roster_manager_rw on public.team_roster;
create policy team_roster_manager_rw on public.team_roster
  for all using (public.is_team_manager(team_id))
  with check (public.is_team_manager(team_id));

-- seasons: reads already flow through the widened can_access_season; writes
-- (creating the team's season, editing it) need their own policy.
drop policy if exists seasons_manager_write on public.seasons;
create policy seasons_manager_write on public.seasons
  for all using (team_id is not null and public.is_team_manager(team_id))
  with check (team_id is not null and public.is_team_manager(team_id));

drop policy if exists season_events_manager_write on public.season_events;
create policy season_events_manager_write on public.season_events
  for all using (exists (select 1 from public.seasons se where se.id = season_id
                         and se.team_id is not null and public.is_team_manager(se.team_id)))
  with check (exists (select 1 from public.seasons se where se.id = season_id
                      and se.team_id is not null and public.is_team_manager(se.team_id)));

drop policy if exists season_roster_manager_write on public.season_roster;
create policy season_roster_manager_write on public.season_roster
  for all using (exists (select 1 from public.seasons se where se.id = season_id
                         and se.team_id is not null and public.is_team_manager(se.team_id)))
  with check (exists (select 1 from public.seasons se where se.id = season_id
                      and se.team_id is not null and public.is_team_manager(se.team_id)));

-- ----------------------------------------------------------------------------
-- RPCs
-- ----------------------------------------------------------------------------
-- The client only ever knows the invitee's email address. Resolving that to a
-- user id needs to read public.profiles across accounts, which RLS won't allow
-- from the client, so the lookup lives here behind an explicit owner/admin gate
-- (same shape as invite_org_member_by_email).
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

  -- Staff on the owning account already have full access through their
  -- membership; a delegation row would be dead weight that also can't be
  -- meaningfully revoked (removing it wouldn't take their access away).
  if exists (
    select 1 from public.teams te
    join public.memberships m on m.account_id = te.account_id
    where te.id = team_uuid
      and m.user_id = target_user_id
      and m.role = any (array['owner','admin','coach']::membership_role[])
  ) then
    raise exception 'That person is already staff on this account and can manage every team';
  end if;

  insert into public.team_managers (team_id, user_id, role, invited_by)
  values (team_uuid, target_user_id, manager_role::team_manager_role, auth.uid())
  on conflict (team_id, user_id) do update set role = excluded.role
  returning id into new_id;

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

-- Delegation rows carry only a user id; the client needs names and emails to
-- render the list, and profiles for other accounts aren't client-readable.
create or replace function public.list_team_managers(team_uuid uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  -- Anyone who can manage the team may see who else manages it (a delegate
  -- included), but only staff can change the list.
  if not public.can_manage_team(team_uuid) then
    raise exception 'Not authorized to view this team';
  end if;

  select coalesce(json_agg(row_to_json(r) order by r.created_at), '[]'::json) into result
  from (
    select tm.id,
           tm.team_id   as "teamId",
           tm.user_id   as "userId",
           tm.role::text as role,
           p.email,
           p.display_name as name,
           tm.created_at
    from public.team_managers tm
    join public.profiles p on p.id = tm.user_id
    where tm.team_id = team_uuid
  ) r;

  return result;
end;
$$;

create or replace function public.remove_team_manager(manager_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.team_managers where id = manager_id;
  if v_team_id is null then
    return; -- already gone; removing twice is not an error
  end if;

  if not public.can_delegate_team(v_team_id) then
    raise exception 'Not authorized to change managers on this team';
  end if;

  delete from public.team_managers where id = manager_id;
end;
$$;

-- Teams delegated TO the caller. listTeams() still queries the caller's own
-- account directly (so a platform admin doesn't get every team on the
-- instance); this supplies the second, much smaller set to merge in.
create or replace function public.list_teams_managed_by_me()
returns setof public.teams
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.teams t
  join public.team_managers tm on tm.team_id = t.id
  where tm.user_id = auth.uid()
    and t.archived = false
  order by t.created_at desc;
$$;

grant execute on function public.invite_team_manager_by_email(uuid, text, text) to authenticated;
grant execute on function public.list_team_managers(uuid)                      to authenticated;
grant execute on function public.remove_team_manager(uuid)                     to authenticated;
grant execute on function public.list_teams_managed_by_me()                    to authenticated;
grant execute on function public.is_team_manager(uuid)                         to authenticated;
grant execute on function public.can_manage_team(uuid)                         to authenticated;
grant execute on function public.can_delegate_team(uuid)                       to authenticated;
