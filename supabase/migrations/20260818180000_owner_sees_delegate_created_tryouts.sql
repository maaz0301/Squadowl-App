-- ============================================================================
-- CLUB mode delegation, part 5: the club owner sees what a delegate creates
-- ----------------------------------------------------------------------------
-- createTryout always inserts under the caller's own account_id
-- (writableAccountId()), even when the new tryout is linked to a team
-- delegated to them. So when a manager creates a new assessment for their
-- managed team, it lands with account_id = the manager's own account, team_id
-- = the club's team — readable by the club's staff already (can_access_tryout
-- was widened for this in part 2), but never *listed* for them, since
-- listTryouts() only fetches rows matching the caller's own account_id.
--
-- This is the mirror image of list_tryouts_for_managed_teams (which solved
-- the same problem for the delegate's side): tryouts on a team the caller's
-- account owns, created under some other account. The `ty.account_id <>
-- te.account_id` guard is what keeps this from duplicating the tryouts the
-- normal account_id-scoped query already returns — this RPC exists purely to
-- fill the one gap that query can't reach.
-- ============================================================================

create or replace function public.list_tryouts_on_my_owned_teams()
returns setof public.tryouts
language sql
stable
security definer
set search_path = public
as $$
  select ty.*
  from public.tryouts ty
  join public.teams te on te.id = ty.team_id
  where public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[])
    and ty.account_id <> te.account_id
    and ty.deleted_at is null
  order by ty.created_at desc;
$$;

grant execute on function public.list_tryouts_on_my_owned_teams() to authenticated;
