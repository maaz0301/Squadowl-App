-- ============================================================================
-- Fix: deleting a team could never detach a tryout created "on the other side"
-- of a club delegation.
-- ----------------------------------------------------------------------------
-- deleteTeam() detaches every tryout linked to a team before archiving it:
--   update tryouts set team_id = null where team_id = <team>
--
-- 20260818150000_team_manager_assessment_access.sql's own comment documents
-- that a tryout linked to a team can carry an account_id from either side of a
-- delegation (a manager creating an assessment from the team hub inserts it
-- under their own account, still linked to the club's team). But the
-- tryouts_manager_write policy it added requires `team_id is not null` in its
-- WITH CHECK — which a detach, by construction, always violates. For a tryout
-- whose account_id isn't the caller's own, tryouts_write's WITH CHECK also
-- fails (the caller has no role on that other account). No permissive policy
-- can ever authorize the update, so any team with at least one tryout created
-- under a different account than its own could never be deleted, by anyone,
-- in either app — surfaced as "new row violates row-level security policy for
-- table tryouts".
--
-- Fixed with a SECURITY DEFINER RPC, the same pattern already used for
-- set_assessor_status/accept_athlete_share for exactly this class of problem
-- (a write whose authorization depends on the OLD row, which a plain UPDATE's
-- WITH CHECK — which only ever sees the NEW row — can't express). The check
-- happens once, up front, against can_manage_team(); the update itself runs
-- with the function's elevated privilege, so the per-row WITH CHECK trap above
-- never gets a chance to reject it.
-- ============================================================================

create or replace function public.detach_team_tryouts(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'Not authorized to manage this team';
  end if;

  update public.tryouts set team_id = null where team_id = p_team_id;
end;
$$;

grant execute on function public.detach_team_tryouts(uuid) to authenticated;
