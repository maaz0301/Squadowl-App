-- ============================================================================
-- CLUB mode delegation, part 6: the club's own staff join the assessments a
-- delegate creates
-- ----------------------------------------------------------------------------
-- 20260818170000 made a delegated manager show up in tryout_assessors for
-- every tryout on their team, in both directions (new manager -> existing
-- tryouts, new team-linked tryout -> existing managers). It only synced the
-- *manager* side though. When a manager creates a brand-new assessment for
-- their delegated team, the club's own owner/admin/coach staff can already
-- reach it (can_access_tryout's team-ownership branch), but they never get an
-- actual tryout_assessors row for it — so the assessment's Assessors list
-- shows only the delegate who created it, never the club's own people.
--
-- This extends sync_new_team_tryout_to_assessors (fired on tryout insert, or
-- team_id being newly attached) to also seed the team-owning account's staff,
-- plus a one-time backfill for tryouts that already exist on a delegated team.
--
-- Scoped to teams that actually have a delegate (`exists (... team_managers
-- ...)`) so this is a no-op for the overwhelming majority of teams that were
-- never delegated to anyone — an account's own coaches creating tryouts for
-- their own non-delegated teams see no change; they already manage those
-- tryouts via has_account_role, same as before.
-- ============================================================================

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

  -- The team-owning account's own staff, but only when the team is actually
  -- delegated to someone — otherwise this is the normal "a coach creates a
  -- tryout for their own team" path, which already works without this.
  insert into public.tryout_assessors (tryout_id, user_id, name, email, role, status)
  select new.id, m.user_id, coalesce(nullif(btrim(p.display_name), ''), p.email), p.email, 'assessor', 'accepted'
  from public.teams te
  join public.memberships m on m.account_id = te.account_id
    and m.role = any(array['owner','admin','coach']::membership_role[])
  join public.profiles p on p.id = m.user_id
  where te.id = new.team_id
    and p.email is not null
    and exists (select 1 from public.team_managers tm2 where tm2.team_id = te.id)
  on conflict (tryout_id, email) do nothing;

  return new;
end;
$$;

-- One-time backfill: assessments a delegate already created for a delegated
-- team, before this migration existed, wouldn't otherwise get the club's
-- staff added until that tryout is edited in a way that re-touches team_id.
insert into public.tryout_assessors (tryout_id, user_id, name, email, role, status)
select ty.id, m.user_id, coalesce(nullif(btrim(p.display_name), ''), p.email), p.email, 'assessor', 'accepted'
from public.tryouts ty
join public.teams te on te.id = ty.team_id
join public.memberships m on m.account_id = te.account_id
  and m.role = any(array['owner','admin','coach']::membership_role[])
join public.profiles p on p.id = m.user_id
where ty.team_id is not null
  and ty.deleted_at is null
  and p.email is not null
  and exists (select 1 from public.team_managers tm where tm.team_id = ty.team_id)
on conflict (tryout_id, email) do nothing;
