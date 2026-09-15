-- deleteTeam() archives a team's seasons alongside the team itself, but that
-- pairing is a relatively recent addition — a team removed before it existed
-- left its season(s) behind with archived = false. Those rows are invisible
-- in every team-scoped screen (their team is gone) but still count toward
-- org-wide stats such as the Enterprise overview's "Seasons" tile, which is
-- why that number could stay stuck above zero after every team and
-- evaluation had been deleted. This is a one-time backfill; deleteTeam()
-- itself already keeps new deletions in sync.
update public.seasons se
set archived = true
from public.teams te
where se.team_id = te.id
  and te.archived = true
  and se.archived = false;

-- Covers the older, harder case: a team row hard-deleted (not soft-deleted)
-- before this account switched to archiving, which nulled out team_id via
-- the seasons.team_id foreign key's `on delete set null` and left no team
-- row to join against above.
update public.seasons se
set archived = true
where se.archived = false
  and se.team_id is null;
