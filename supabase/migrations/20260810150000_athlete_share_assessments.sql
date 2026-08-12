-- ============================================================================
-- Full assessment history on athlete_shares
-- ----------------------------------------------------------------------------
-- Frozen assessment history (PlayerProfileAssessment[]) at share time. The
-- receiving coach has no RLS access to the guardian's original club's
-- tryouts/evaluations — granting that would leak the whole roster, not just
-- this one athlete — so "full profile with assessments" is a snapshot here,
-- not a live query. Populated by shareAthleteWithCoach going forward; shares
-- created before this migration keep an empty snapshot ('[]').
-- ============================================================================

alter table public.athlete_shares
  add column if not exists athlete_assessments jsonb not null default '[]'::jsonb;
