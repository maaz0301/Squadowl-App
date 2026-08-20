-- ============================================================================
-- Live scores for an athlete share
-- ----------------------------------------------------------------------------
-- athlete_shares.athlete_assessments is a frozen snapshot taken at share time
-- (20260810150000_athlete_share_assessments.sql) — the receiving coach has no
-- RLS access to the guardian's tryouts/evaluations, so it can't be a live
-- join; granting that would leak the guardian's whole roster, not just this
-- one athlete.
--
-- This adds a narrowly-scoped SECURITY DEFINER function instead: given a
-- share, it returns fresh evaluation data for *only* the tryout(s) already
-- captured in that share's own frozen snapshot — never a tryout added later,
-- and never any other athlete on the guardian's roster. The client
-- (getAthleteShare) overlays these onto the snapshot so scores/recommendations
-- stay current while identity fields (name, contact info, etc.) remain the
-- point-in-time record the guardian actually agreed to share.
-- ============================================================================

create or replace function public.get_athlete_share_live_scores(p_share_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with share as (
    select s.*
      from public.athlete_shares s
     where s.id = p_share_id
       and (
         s.guardian_user_id = auth.uid()
         or public.has_account_role(s.coach_account_id, array['owner','admin','coach']::membership_role[])
       )
  ),
  -- The only tryouts this function will ever touch: whatever was already
  -- frozen into the snapshot at share time. A tryout created after the share
  -- (or any other tryout on the guardian's account) never appears here.
  shared_tryout_ids as (
    select distinct (elem->>'tryoutId')::uuid as tryout_id
      from share, jsonb_array_elements(share.athlete_assessments) elem
     where elem ? 'tryoutId'
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tryout_id', tp.tryout_id,
        'position', tp.position,
        'sport', t.sport,
        'settings', t.settings,
        'evaluations', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', e.id,
                'participant_id', e.participant_id,
                'created_at', e.created_at,
                'updated_at', e.updated_at,
                'evaluator_name', e.evaluator_name,
                'session', e.session,
                'strengths', e.strengths,
                'improve', e.improve,
                'recommendation', e.recommendation::text,
                'source', e.source,
                'evaluation_scores', (
                  select coalesce(
                    jsonb_agg(jsonb_build_object('rubric_key', sc.rubric_key, 'value', sc.value)),
                    '[]'::jsonb
                  )
                    from public.evaluation_scores sc
                   where sc.evaluation_id = e.id
                )
              )
            ),
            '[]'::jsonb
          )
            from public.evaluations e
           where e.participant_id = tp.id
        )
      )
    ),
    '[]'::jsonb
  )
  from share
  join shared_tryout_ids sti on true
  join public.tryout_participants tp on tp.tryout_id = sti.tryout_id and tp.athlete_id = share.athlete_id
  join public.tryouts t on t.id = tp.tryout_id;
$$;

revoke all on function public.get_athlete_share_live_scores(uuid) from public;
grant execute on function public.get_athlete_share_live_scores(uuid) to authenticated;
