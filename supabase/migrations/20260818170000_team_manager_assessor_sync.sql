-- ============================================================================
-- CLUB mode delegation, part 4: team managers also become assessors
-- ----------------------------------------------------------------------------
-- Delegating a team already grants RLS access to its tryouts (part 2's
-- can_access_tryout / can_manage_tryout widening), but that access is
-- invisible to the app in a specific way: nothing puts the manager in
-- tryout_assessors, so they never show up in a tryout's Assessors list, never
-- appear in listAssignedTryouts() ("assigned to me"), and never get treated
-- as an assessor by anything that reads that table directly.
--
-- Three triggers keep tryout_assessors in sync as things change, rather than a
-- one-time backfill that goes stale the moment a new tryout is created or a
-- manager is added/removed later:
--   1. A new team manager -> assessor row on every existing tryout for that team.
--   2. A tryout newly linked to a team (created with team_id, or attached to
--      one later) -> assessor row for every manager of it.
--   3. A manager removed -> their assessor row(s) for that team's tryouts go
--      too, so a revoked delegate doesn't linger in the Assessors list with
--      RLS access already gone underneath them.
-- All security definer so they run regardless of the inserting/deleting
-- session's own RLS — matches every other cross-table sync in this schema.
-- ============================================================================

create or replace function public.sync_new_team_manager_to_assessors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_email text;
begin
  select display_name, email into v_name, v_email from public.profiles where id = new.user_id;
  if v_email is null then
    return new;
  end if;

  insert into public.tryout_assessors (tryout_id, user_id, name, email, role, status)
  select ty.id, new.user_id, coalesce(nullif(btrim(v_name), ''), v_email), v_email, 'assessor', 'accepted'
  from public.tryouts ty
  where ty.team_id = new.team_id and ty.deleted_at is null
  on conflict (tryout_id, email) do nothing;

  return new;
end;
$$;

drop trigger if exists team_manager_sync_assessors on public.team_managers;
create trigger team_manager_sync_assessors
  after insert on public.team_managers
  for each row execute function public.sync_new_team_manager_to_assessors();

create or replace function public.sync_new_team_tryout_to_assessors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.team_id is null then
    return new;
  end if;
  -- Only act when team_id is newly set on this row — either created with one,
  -- or an existing tryout was just attached to a team. An update that leaves
  -- team_id unchanged (editing the tryout's name, say) shouldn't re-scan managers.
  if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id then
    return new;
  end if;

  insert into public.tryout_assessors (tryout_id, user_id, name, email, role, status)
  select new.id, tm.user_id, coalesce(nullif(btrim(p.display_name), ''), p.email), p.email, 'assessor', 'accepted'
  from public.team_managers tm
  join public.profiles p on p.id = tm.user_id
  where tm.team_id = new.team_id and p.email is not null
  on conflict (tryout_id, email) do nothing;

  return new;
end;
$$;

drop trigger if exists tryout_sync_manager_assessors on public.tryouts;
create trigger tryout_sync_manager_assessors
  after insert or update of team_id on public.tryouts
  for each row execute function public.sync_new_team_tryout_to_assessors();

create or replace function public.remove_team_manager_from_assessors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.tryout_assessors ta
  using public.tryouts ty
  where ta.tryout_id = ty.id
    and ty.team_id = old.team_id
    and ta.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists team_manager_remove_assessors on public.team_managers;
create trigger team_manager_remove_assessors
  after delete on public.team_managers
  for each row execute function public.remove_team_manager_from_assessors();

-- One-time backfill: team_managers grants made before this migration existed
-- (this feature has already been used live) wouldn't otherwise get an
-- assessor row until the delegate is re-invited or a new tryout is attached.
insert into public.tryout_assessors (tryout_id, user_id, name, email, role, status)
select ty.id, tm.user_id, coalesce(nullif(btrim(p.display_name), ''), p.email), p.email, 'assessor', 'accepted'
from public.team_managers tm
join public.profiles p on p.id = tm.user_id
join public.tryouts ty on ty.team_id = tm.team_id and ty.deleted_at is null
where p.email is not null
on conflict (tryout_id, email) do nothing;
