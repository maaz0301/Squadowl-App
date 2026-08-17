-- getGuardianRosters() was timing out (57014, "canceling statement due to statement
-- timeout") for coaches and guardians alike. Two causes, both fixed here.
--
-- 1. event_availability had no index on roster_id. The unique constraint is
--    (season_event_id, roster_id), so its btree can't serve a roster_id lookup —
--    every RSVP fetch for every roster row was a full scan of the table.
--
-- 2. The client fetched one deeply nested PostgREST embed
--    (athletes → tryout_participants → evaluations → evaluation_scores, and
--    athletes → season_roster → seasons → season_events / event_availability).
--    RLS ran per row at every level, and the innermost policies are the expensive
--    ones: eval_scores_rw re-runs can_access_tryout() for each score row, and
--    availability_read re-runs can_access_season() for each RSVP row. The cost is
--    multiplicative in the size of the tree.
--
-- get_guardian_rosters() collapses that into one statement that authorizes per
-- athlete, per tryout and per season instead of per leaf row. It reuses the very
-- predicates the RLS policies use — can_access_athlete(), can_access_tryout(),
-- can_access_season() — so the rows a caller can see are unchanged. This is a
-- performance fix, not a permissions change: guardians keep the tryout access
-- 0006_guardian_roster_access.sql granted them, and nobody gains anything.

create index if not exists idx_event_availability_roster
  on public.event_availability (roster_id);

-- Matches the client's own guardian matching: the linked user id, or the athlete's
-- guardian_email when the accounts were never linked up. guardian_email is citext,
-- so the comparison is case-insensitive and still uses idx_athletes_guardian_email.
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
        )
      )
    ),
    '[]'::jsonb
  )
  from mine a;
$$;

revoke all on function public.get_guardian_rosters() from public;
grant execute on function public.get_guardian_rosters() to authenticated;
