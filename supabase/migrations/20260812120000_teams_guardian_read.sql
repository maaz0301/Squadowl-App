-- Guardians can already read season_roster and seasons for seasons their
-- athlete is on (season_roster_read / seasons_read -> can_access_season), but
-- teams_rw only grants read via has_account_access (staff membership) —
-- so a guardian's getGuardianRosters query, which embeds
-- season_roster -> seasons -> teams(collects_fees, registration_fee_cents),
-- silently got teams as null and the team-fee UI never showed anything.
create policy teams_guardian_read on public.teams
  for select using (
    exists (
      select 1 from public.season_roster sr
      join public.seasons se on se.id = sr.season_id
      join public.athletes at on at.id = sr.athlete_id
      where se.team_id = teams.id and at.guardian_user_id = auth.uid()
    )
  );
