-- Teams previously had no roster of their own: a team's players could only be
-- inferred as the union of participants across its linked assessments. This adds
-- a real, directly-editable team roster so athletes can be selected from any
-- assessment and attached to a team independently of that assessment.
--
-- Mirrors public.season_roster in shape, indexes, and RLS.

create table if not exists public.team_roster (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  jersey     text,
  position   text,
  -- Assessment the athlete was pulled from, kept for provenance. Nulled rather
  -- than cascaded so deleting a tryout never silently drops roster entries.
  source_tryout_id uuid references public.tryouts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, athlete_id)
);

create index if not exists idx_team_roster_team on public.team_roster(team_id);
create index if not exists idx_team_roster_athlete on public.team_roster(athlete_id);

drop trigger if exists set_team_roster_updated_at on public.team_roster;
create trigger set_team_roster_updated_at
  before update on public.team_roster
  for each row execute function public.set_updated_at();

alter table public.team_roster enable row level security;

-- Read: anyone with access to the owning account (matches teams_rw's using clause).
drop policy if exists team_roster_read on public.team_roster;
create policy team_roster_read on public.team_roster
  for select using (exists (select 1 from public.teams t where t.id = team_id
                            and public.has_account_access(t.account_id)));

-- Write: staff only, same roles that may manage the team itself.
drop policy if exists team_roster_write on public.team_roster;
create policy team_roster_write on public.team_roster
  for all using (exists (select 1 from public.teams t where t.id = team_id
                         and public.has_account_role(t.account_id, array['owner','admin','coach']::membership_role[])))
  with check (exists (select 1 from public.teams t where t.id = team_id
                      and public.has_account_role(t.account_id, array['owner','admin','coach']::membership_role[])));
