-- Tracks which plan-usage nudges (85% of a limit) have already been pushed to a
-- user, so we send each tier/metric crossing exactly once instead of on every
-- render or every subsequent player/team/assessment/rubric added.
create table public.usage_nudge_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  metric text not null check (metric in ('players', 'teams', 'assessments', 'customRubrics')),
  plan_tier text not null,
  notified_at timestamptz not null default now(),
  unique (user_id, metric, plan_tier)
);

create index usage_nudge_notifications_user_id_idx on public.usage_nudge_notifications(user_id);

alter table public.usage_nudge_notifications enable row level security;

create policy "Users can insert their own usage nudges"
  on public.usage_nudge_notifications
  for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own usage nudges"
  on public.usage_nudge_notifications
  for select
  using (auth.uid() = user_id);
