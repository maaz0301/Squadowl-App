-- ============================================================================
-- CLUB mode delegation, part 7: schedules travel with the team, in both
-- directions
-- ----------------------------------------------------------------------------
-- can_access_season (20260818120000) already lets a delegate read a season
-- linked to their delegated team, and seasons_manager_write already lets them
-- create one. But listSeasons() -- what the Team screen uses to find "this
-- team's season" -- filters strictly by the caller's own account_id, same
-- mistake listTryouts() had before list_tryouts_for_managed_teams /
-- list_tryouts_on_my_owned_teams (20260818150000 / 20260818180000) fixed it:
--
--   * A delegate creating a season for their team inserts it under their OWN
--     account_id (createSeason always did, unlike createTryout which already
--     resolves the team's real account) -- so the club's own listSeasons()
--     never sees it: schedule missing for the club side.
--   * Conversely, a season the club's own staff created for a team now
--     delegated to someone never shows in that delegate's listSeasons() --
--     schedule missing for the delegate side.
--
-- Same two-RPC shape as the tryouts fix, reused by SupabaseDataSource's
-- listSeasons() to merge both extra sources in.
-- ============================================================================

create or replace function public.list_seasons_for_managed_teams()
returns setof public.seasons
language sql
stable
security definer
set search_path = public
as $$
  select se.*
  from public.seasons se
  join public.team_managers tm on tm.team_id = se.team_id
  where tm.user_id = auth.uid()
    and se.archived = false
  order by se.created_at desc;
$$;

grant execute on function public.list_seasons_for_managed_teams() to authenticated;

create or replace function public.list_seasons_on_my_owned_teams()
returns setof public.seasons
language sql
stable
security definer
set search_path = public
as $$
  select se.*
  from public.seasons se
  join public.teams te on te.id = se.team_id
  where public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[])
    and se.account_id <> te.account_id
    and se.archived = false
  order by se.created_at desc;
$$;

grant execute on function public.list_seasons_on_my_owned_teams() to authenticated;
