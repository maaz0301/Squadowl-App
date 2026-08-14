-- getGuardianRosters() matches guardians by guardian_user_id OR guardian_email.
-- guardian_user_id was already indexed (idx_athletes_guardian); guardian_email
-- was not, so the OR forced a sequential scan of the whole athletes table
-- (across every account) with the per-row can_access_athlete() RLS check plus
-- the query's deep nested joins evaluated on every candidate row, timing out
-- (57014) once the table had enough rows.
create index if not exists idx_athletes_guardian_email on public.athletes(guardian_email);
