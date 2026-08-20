-- ============================================================================
-- Athlete share live scores: cover tryouts added *after* the share too
-- ----------------------------------------------------------------------------
-- get_athlete_share_live_scores() (20260820120000) only refreshed scores for
-- tryout(s) already present in the frozen athlete_assessments snapshot at
-- share time. That misses the common case: the guardian shares the athlete
-- while their profile is still empty (or thin), then the athlete gets
-- evaluated in a *new* tryout afterward — the coach never saw it, because the
-- live function was scoped to the snapshot's own tryout list, and the
-- snapshot itself never grows after insert.
--
-- Re-scope to every tryout_participants row for this *one* athlete_id,
-- regardless of when it was created. This is still narrow — never any other
-- athlete on the guardian's roster, which was the actual concern the original
-- snapshot design was guarding against — it just stops pinning the boundary
-- to a point in time for the one athlete that was actually shared.
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
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tryout_id', tp.tryout_id,
        'participant_id', tp.id,
        'position', tp.position,
        'sport', t.sport,
        'event_type', t.event_type,
        'tryout_name', t.name,
        'tryout_date', t.tryout_date,
        'season_id', t.season_id,
        'team_name', tm.name,
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
  join public.tryout_participants tp on tp.athlete_id = share.athlete_id
  join public.tryouts t on t.id = tp.tryout_id and t.deleted_at is null
  left join public.teams tm on tm.id = t.team_id;
$$;

revoke all on function public.get_athlete_share_live_scores(uuid) from public;
grant execute on function public.get_athlete_share_live_scores(uuid) to authenticated;
