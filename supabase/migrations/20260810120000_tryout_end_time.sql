-- Assessments could only record a start time, so coaches had no way to
-- communicate when a tryout/assessment session wraps up.
alter table public.tryouts add column if not exists end_time text;
