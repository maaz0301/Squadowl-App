-- get_guardian_rosters() (20260817130000) excludes a soft-deleted tryout
-- (t.deleted_at, added in 20260915130000) but never checked
-- tryout_participants.removed_at — the separate soft delete deletePlayer()
-- uses to take one player off a *specific* evaluation's roster without
-- touching the tryout itself (see assembleTryouts()/countTeamPlayers(), which
-- both filter on it the same way). A player removed from just the evaluation
-- kept showing that tryout on their guardian's "My Athletes" indefinitely.
--
-- filterActiveGuardianRosters (client, SupabaseDataSource.ts) already drops an
-- athlete's card entirely once nothing active is left across tryouts/seasons —
-- this is what lets that logic see a removed evaluation as gone rather than
-- still-active when it's the athlete's only roster spot.
create or replace function public.get_guardian_rosters()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as uid,
           nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '') as email
  ),
  mine as (
    select at.id, at.first_name, at.last_name, at.avatar_url
      from public.athletes at
      cross join me
     where me.uid is not null
       and (
         at.guardian_user_id = me.uid
         or (me.email is not null and at.guardian_email = me.email::citext)
       )
       -- SECURITY DEFINER skips athletes_read, so apply its predicate explicitly.
       -- Without this the email branch would return athletes RLS hides today (it has
       -- no guardian_email branch), which would be a permissions change rather than a
       -- performance fix. Evaluated once per matched athlete, not per nested row.
       and public.can_access_athlete(at.id)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'first_name', a.first_name,
        'last_name', a.last_name,
        'avatar_url', a.avatar_url,
        'tryout_participants', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', tp.id,
                'tryout_id', tp.tryout_id,
                'tryouts', jsonb_build_object('id', t.id, 'name', t.name, 'sport', t.sport),
                'evaluations', (
                  select coalesce(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', e.id,
                        'session', e.session,
                        'recommendation', e.recommendation::text,
                        'created_at', e.created_at,
                        'evaluation_scores', (
                          select coalesce(
                            jsonb_agg(jsonb_build_object('rubric_key', s.rubric_key, 'value', s.value)),
                            '[]'::jsonb
                          )
                            from public.evaluation_scores s
                           where s.evaluation_id = e.id
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
            from public.tryout_participants tp
            join public.tryouts t on t.id = tp.tryout_id
           where tp.athlete_id = a.id
             -- Same gate as participants_read / evaluations_read / eval_scores_rw,
             -- but evaluated once per tryout instead of once per score row.
             and public.can_access_tryout(tp.tryout_id)
             -- Deleted evaluation: soft_delete_tryout() only sets deleted_at, so
             -- without this the row keeps surfacing here forever.
             and t.deleted_at is null
             -- This one player removed from the evaluation (not the whole tryout
             -- deleted) — deletePlayer() only sets removed_at (20260915160000).
             and tp.removed_at is null
        ),
        'season_roster', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', sr.id,
                'jersey', sr.jersey,
                'fee_status', sr.fee_status,
                'event_availability', (
                  select coalesce(
                    jsonb_agg(jsonb_build_object(
                      'season_event_id', ea.season_event_id,
                      'response', ea.response::text
                    )),
                    '[]'::jsonb
                  )
                    from public.event_availability ea
                   where ea.roster_id = sr.id
                ),
                'seasons', jsonb_build_object(
                  'id', se.id,
                  'name', se.name,
                  'team_name', se.team_name,
                  'sport', se.sport,
                  'team_id', se.team_id,
                  'teams', case
                             when tm.id is null then null
                             else jsonb_build_object(
                               'collects_fees', tm.collects_fees,
                               'registration_fee_cents', tm.registration_fee_cents
                             )
                           end,
                  'season_events', (
                    -- Only events this athlete is actually scheduled for. The client
                    -- filtered these out client-side anyway, so this just stops the
                    -- whole season's calendar from crossing the wire per athlete.
                    select coalesce(
                      jsonb_agg(jsonb_build_object(
                        'id', ev.id,
                        'kind', ev.kind::text,
                        'title', ev.title,
                        'event_date', ev.event_date,
                        'start_time', ev.start_time,
                        'end_time', ev.end_time,
                        'location', ev.location,
                        'notes', ev.notes
                      )),
                      '[]'::jsonb
                    )
                      from public.season_events ev
                     where ev.season_id = se.id
                       and exists (
                         select 1 from public.event_availability ea2
                          where ea2.season_event_id = ev.id and ea2.roster_id = sr.id
                       )
                  )
                )
              )
            ),
            '[]'::jsonb
          )
            from public.season_roster sr
            join public.seasons se on se.id = sr.season_id
            left join public.teams tm on tm.id = se.team_id
           where sr.athlete_id = a.id
             -- Same gate as season_roster_read / seasons_read / season_events_read /
             -- availability_read, evaluated once per season.
             and public.can_access_season(sr.season_id)
             -- Deleted team/season: deleteTeam() archives both the team and its
             -- seasons (and 20260915120000 backfilled the older rows this missed),
             -- deleteSeason() hard-deletes the row outright. Either way, an
             -- archived season is gone from every coach-facing screen and must
             -- stop showing up for the guardian too.
             and se.archived = false
        )
      )
    ),
    '[]'::jsonb
  )
  from mine a;
$$;

revoke all on function public.get_guardian_rosters() from public;
grant execute on function public.get_guardian_rosters() to authenticated;
