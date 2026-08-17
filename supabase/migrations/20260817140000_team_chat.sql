-- ============================================================================
-- Team chat
-- ----------------------------------------------------------------------------
-- Scoped to a season rather than a team: a team's players are its season_roster
-- rows, and can_access_season() already resolves to exactly the audience a team
-- chat needs — staff on the owning account, plus the guardian of any athlete on
-- that season's roster. Reusing it means adding a player to the team roster is
-- what puts their guardian in the chat, with no second membership list to keep
-- in sync (and no way for the two to drift apart).
-- ============================================================================
create table public.season_messages (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references public.seasons(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  author_name    text not null,
  author_role    text not null check (author_role in ('coach', 'guardian')),
  body           text not null check (char_length(body) between 1 and 2000),
  created_at     timestamptz not null default now()
);

create index idx_season_messages_season on public.season_messages (season_id, created_at desc);

alter table public.season_messages enable row level security;

create policy season_messages_select on public.season_messages
  for select using (public.can_access_season(season_id));

-- No INSERT policy: every write goes through send_season_message() below, which
-- derives author_name/author_role server-side. Letting clients supply those
-- would let a guardian post as a coach.

-- An author can retract their own message; staff on the season's account can
-- remove anyone's (moderation). Bodies are never edited in place, so that a
-- message someone reacted to can't be swapped out from under them.
create policy season_messages_delete on public.season_messages
  for delete using (
    author_user_id = auth.uid()
    or exists (
      select 1 from public.seasons se
      where se.id = season_id
        and public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
    )
  );

create or replace function public.send_season_message(p_season_id uuid, p_body text)
returns public.season_messages
language plpgsql security definer set search_path = public as $$
declare
  v_row        public.season_messages;
  v_account_id uuid;
  v_role       text;
  v_name       text;
  v_body       text := btrim(p_body);
begin
  if v_body = '' then
    raise exception 'Message cannot be empty';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'Message is too long (2000 characters max)';
  end if;
  -- SECURITY DEFINER skips season_messages_select, so gate on the same predicate
  -- that policy uses rather than trusting the caller's season id.
  if not public.can_access_season(p_season_id) then
    raise exception 'Not authorized to post in this team chat';
  end if;

  select account_id into v_account_id from public.seasons where id = p_season_id;
  v_role := case
              when public.has_account_role(v_account_id, array['owner','admin','coach']::membership_role[])
                then 'coach'
              else 'guardian'
            end;
  select display_name into v_name from public.profiles where id = auth.uid();

  insert into public.season_messages (season_id, author_user_id, author_name, author_role, body)
  values (p_season_id, auth.uid(), coalesce(nullif(btrim(v_name), ''), 'Unknown'), v_role, v_body)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.send_season_message(uuid, text) from public;
grant execute on function public.send_season_message(uuid, text) to authenticated;

-- Opt the table into realtime broadcasts. Subscribers still go through
-- season_messages_select, so a guardian only receives their own team's traffic.
alter publication supabase_realtime add table public.season_messages;

-- Default replica identity puts only the primary key in a DELETE's payload, so
-- a subscription filtered on season_id would never match one and a retracted
-- message would linger on everyone else's screen until they reopened the tab.
alter table public.season_messages replica identity full;
