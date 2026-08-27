-- ============================================================================
-- Fix: assessment roster read times out (57014) on a ~1000-player assessment
-- ----------------------------------------------------------------------------
-- Confirmed from the project's own logs: opening a large assessment returns
-- some `tryout_participants` pages 200 OK, and ~8s later something in the same
-- burst dies with "57014 canceling statement due to statement timeout".
-- assembleTryouts() fires participants / assessors / evaluations / registrations
-- concurrently, so the 200 and the timeout are different statements — and the
-- expensive one is the evaluations read.
--
-- Why that read in particular. It asks for
-- `evaluations(..., evaluation_scores(rubric_key, value))`, and
-- `evaluation_scores` carries TWO permissive SELECT policies which are OR'd and
-- therefore BOTH evaluated for every score row:
--
--   eval_scores_rw   (0017) -> exists(... e.evaluator_user_id = auth.uid()
--                                      or can_manage_tryout(e.tryout_id))
--   eval_scores_read (0010) -> exists(... can_access_tryout(e.tryout_id))
--
-- Each one re-queries `evaluations` and then calls can_access_tryout(), which
-- itself queries `tryouts` -> has_account_role() -> is_platform_admin() +
-- `memberships`. A 1000-player x 5-session assessment is ~5,000 evaluations and
-- ~50,000 score rows, so a single roster open drives hundreds of thousands of
-- nested SECURITY DEFINER calls. 20260817130000_guardian_rosters_rpc.sql already
-- diagnosed exactly this shape and said so outright: "eval_scores_rw re-runs
-- can_access_tryout() for each score row ... The cost is multiplicative in the
-- size of the tree."
--
-- Paging the read smaller cannot fix it: the policies run on candidate rows
-- *before* LIMIT applies, so a smaller page only moves the crossover point.
--
-- The fix is the one this schema already uses for the same problem in
-- get_guardian_rosters() and get_event_availability(): authorize ONCE per
-- tryout, then return that tryout's evaluations with their scores folded in.
-- Inside a SECURITY DEFINER function the per-score-row policies never run at
-- all, which is where the entire cost lived.
--
-- PERMISSIONS ARE UNCHANGED — this changes *when* the check runs, never *what*
-- it permits. Effective SELECT predicate on `evaluations` today is the OR of
-- evaluations_read and evaluations_write(FOR ALL):
--     can_access_tryout(tryout_id) or evaluator_user_id = auth.uid()
--                                  or can_manage_tryout(tryout_id)
-- and can_manage_tryout() is a strict subset of can_access_tryout() (access
-- additionally admits invited assessors), so that reduces exactly to
--     can_access_tryout(tryout_id) or evaluator_user_id = auth.uid()
-- which is what the WHERE clause below reproduces. The two eval_scores policies
-- OR out to the same predicate on the parent evaluation, so any score belonging
-- to an evaluation this function returns was already readable by that caller.
--
-- Deliberately NOT copied from the web repo's unapplied draft of this function
-- (Athlete-Assessment-web/supabase/migrations/20260824000100_evaluations_rpc.sql),
-- which gated on has_account_access(t.account_id). That is narrower than the
-- real policies and would have silently returned zero evaluations to invited
-- assessors and delegated team managers. That draft flagged the risk itself and
-- asked for the predicate to be diffed against the live policies before use;
-- this is that diff, applied.
--
-- Signature matches the web app's caller (p_tryout_ids, p_after_id, p_limit) so
-- both clients can share one function. `setof jsonb` is still subject to
-- PostgREST's db-max-rows cap, hence the keyset cursor: callers page until a
-- short page comes back.
-- ============================================================================

drop function if exists public.get_evaluations_for_tryouts(uuid[]);
drop function if exists public.get_evaluations_for_tryouts(uuid[], uuid, int);

create function public.get_evaluations_for_tryouts(
  p_tryout_ids uuid[],
  p_after_id   uuid default null,
  p_limit      int  default 1000
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    -- Once per tryout in the batch, not once per evaluation and not once per
    -- score row. This is the whole point of the function.
    select t.id
    from unnest(p_tryout_ids) as t(id)
    where public.can_access_tryout(t.id)
  )
  select to_jsonb(e) || jsonb_build_object(
    'evaluation_scores',
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('rubric_key', es.rubric_key, 'value', es.value))
        from public.evaluation_scores es
        where es.evaluation_id = e.id
      ),
      '[]'::jsonb
    )
  )
  from public.evaluations e
  where e.tryout_id = any(p_tryout_ids)
    and (p_after_id is null or e.id > p_after_id)
    and (
      e.tryout_id in (select id from allowed)
      -- An evaluator keeps sight of their own work even if they were later
      -- removed as an assessor on the tryout (evaluations_write, 0017).
      or e.evaluator_user_id = auth.uid()
    )
  -- Total order for keyset paging: pages can neither overlap nor skip.
  order by e.id
  limit p_limit;
$$;

revoke all on function public.get_evaluations_for_tryouts(uuid[], uuid, int) from public;
grant execute on function public.get_evaluations_for_tryouts(uuid[], uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Planner statistics.
--
-- These tables are filled in bulk by the dummy-data generator (a 1000-player
-- run inserts thousands of rows in a handful of statements), which leaves
-- reltuples badly stale until autovacuum catches up. Stale stats are also why
-- 20260826150000's new (tryout_id, id) indexes may not have been chosen yet.
-- Free to run and it makes the planner's choices reflect the data that is
-- actually there.
-- ----------------------------------------------------------------------------
analyze public.evaluations;
analyze public.evaluation_scores;
analyze public.tryout_participants;
analyze public.athletes;
analyze public.registrations;
