-- ============================================================================
-- Fix: existing team events show grossly inflated "pending" counts (e.g. 999,
--      2004) — far past any real team's headcount.
-- ----------------------------------------------------------------------------
-- create_season_event_for_caller() (20260826180000) invites the WHOLE season
-- roster when the client doesn't narrow p_roster_ids, and syncSeasonRosterFromTeam
-- (src/features/queries.ts) back-fills that season roster from every
-- assessment ever attached to the team — an assessment that was attached,
-- generated its dummy participants, then detached leaves all of them on the
-- season roster forever. Every event saved before the app fix (queries.ts,
-- useAddTeamEventMutation) invited that whole bloated roster instead of just
-- the team's actual players, which is where the 999/2004-pending counts in
-- the coach's "Who's coming?" list come from.
--
-- The app fix only changes behavior for events saved from now on. This is the
-- one-time cleanup for events that already exist: for any event on a
-- team-linked season, drop the invites (event_availability rows) for players
-- who are on the season roster but NOT on that team's team_roster.
--
-- Scoped to response = 'pending' on purpose — an athlete who already recorded
-- a real yes/maybe/no is left alone even if they've since left the team's
-- roster, since that's an actual answer a guardian gave, not phantom
-- assessment-leftover noise.
-- ============================================================================

delete from public.event_availability ea
where ea.response = 'pending'
  and exists (
    select 1
    from public.season_roster sr
    join public.season_events se on se.id = ea.season_event_id
    join public.seasons s on s.id = se.season_id
    where sr.id = ea.roster_id
      and sr.season_id = se.season_id
      and s.team_id is not null
      and not exists (
        select 1
        from public.team_roster tr
        where tr.team_id = s.team_id
          and tr.athlete_id = sr.athlete_id
      )
  );

analyze public.event_availability;
