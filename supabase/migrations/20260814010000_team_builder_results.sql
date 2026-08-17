-- ============================================================================
-- Team Builder: saved team-set snapshots
-- ----------------------------------------------------------------------------
-- Each "Generate Teams" call overwrites the working draft cached on
-- tryouts.ai_assessments.teamBuilder. This table lets a coach explicitly save
-- a generated split as a permanent, named snapshot so a later regeneration
-- doesn't destroy it. RLS mirrors tryout_participants: any assessor on the
-- tryout can read, only account staff (owner/admin/coach) can write.
-- ============================================================================

create table public.team_builder_results (
  id          uuid primary key default gen_random_uuid(),
  tryout_id   uuid not null references public.tryouts(id) on delete cascade,
  label       text not null,
  state       jsonb not null,        -- full TeamBuilderState blob (see src/data/teamBuilder.ts)
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_team_builder_results_tryout on public.team_builder_results(tryout_id);

alter table public.team_builder_results enable row level security;

create policy team_builder_results_read on public.team_builder_results
  for select using (public.can_access_tryout(tryout_id));
create policy team_builder_results_write on public.team_builder_results
  for all using (public.can_manage_tryout(tryout_id))
  with check (public.can_manage_tryout(tryout_id));
