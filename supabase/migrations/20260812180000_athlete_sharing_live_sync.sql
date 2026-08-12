-- ============================================================================
-- Athlete account access grants (replaces copy-on-accept sharing)
-- ----------------------------------------------------------------------------
-- Accepting a share no longer copies the athlete into a new row. Instead it
-- grants the accepting coach's account read/update access to the SAME
-- athletes row via this table, so the original account, the granted account,
-- and the guardian all see one live profile / one live participation
-- history. Once accept_athlete_share inserts a real tryout_participants row
-- using the original athlete_id, the guardian automatically gets live read
-- access to the new coach's evaluations too, via the existing guardian
-- branch on can_access_tryout (0006_guardian_roster_access.sql) — no change
-- needed there. Single-active-grant-at-a-time for now (see
-- accept_athlete_share): this does not add multi-club support, it only
-- replaces "copy" with "grant" for the same one-winner semantics that
-- already existed.
-- ============================================================================
create table public.athlete_account_access (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  share_id    uuid references public.athlete_shares(id) on delete set null,
  granted_at  timestamptz not null default now(),
  unique (athlete_id, account_id)
);
create index idx_athlete_account_access_athlete on public.athlete_account_access(athlete_id);
create index idx_athlete_account_access_account on public.athlete_account_access(account_id);
alter table public.athlete_account_access enable row level security;

-- Read-only for humans; all writes happen exclusively through the
-- SECURITY DEFINER functions below (same convention as athlete_shares).
create policy athlete_account_access_select on public.athlete_account_access
  for select using (
    public.has_account_role(account_id, array['owner','admin','coach']::membership_role[])
    or exists (select 1 from public.athletes at where at.id = athlete_id
               and public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[]))
  );

-- ----------------------------------------------------------------------------
-- can_access_athlete: add the grant branch (pure superset of the prior
-- definition — every existing TRUE case still holds).
-- ----------------------------------------------------------------------------
create or replace function public.has_athlete_account_access(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athlete_account_access aaa
    where aaa.athlete_id = a
      and public.has_account_role(aaa.account_id, array['owner','admin','coach']::membership_role[])
  );
$$;

create or replace function public.can_access_athlete(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
      or at.guardian_user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.tryout_participants tp
    join public.tryout_assessors ta on ta.tryout_id = tp.tryout_id
    where tp.athlete_id = a and ta.user_id = auth.uid()
  )
  or public.has_athlete_account_access(a);
$$;

-- ----------------------------------------------------------------------------
-- athletes RLS: split the single "athletes_write" (for all) policy so that
-- only the owning account can insert/delete, but a granted account can also
-- update (edit the shared profile: medical info, avatar, about, etc).
-- ----------------------------------------------------------------------------
drop policy if exists athletes_write on public.athletes;

create policy athletes_insert on public.athletes
  for insert
  with check (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

create policy athletes_update on public.athletes
  for update
  using (
    public.has_account_role(account_id, array['owner','admin','coach']::membership_role[])
    or public.has_athlete_account_access(id)
  )
  with check (
    public.has_account_role(account_id, array['owner','admin','coach']::membership_role[])
    or public.has_athlete_account_access(id)
  );

create policy athletes_delete on public.athletes
  for delete
  using (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

-- ----------------------------------------------------------------------------
-- accept_athlete_share: grant access to the original athlete instead of
-- copying it into a new row.
-- ----------------------------------------------------------------------------
create or replace function public.accept_athlete_share(p_share_id uuid, p_tryout_id uuid)
returns public.athlete_shares
language plpgsql security definer set search_path = public as $$
declare
  v_share public.athlete_shares;
  v_participant_id uuid;
begin
  select * into v_share from public.athlete_shares where id = p_share_id for update;
  if v_share.id is null then
    raise exception 'Share not found';
  end if;
  if not public.has_account_role(v_share.coach_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Not authorized to accept this share';
  end if;
  if v_share.status <> 'shared' then
    raise exception 'Share is no longer pending';
  end if;
  if not exists (select 1 from public.tryouts t where t.id = p_tryout_id and t.account_id = v_share.coach_account_id) then
    raise exception 'Tryout does not belong to this account';
  end if;

  insert into public.athlete_account_access (athlete_id, account_id, share_id)
  values (v_share.athlete_id, v_share.coach_account_id, p_share_id)
  on conflict (athlete_id, account_id) do nothing;

  insert into public.tryout_participants (tryout_id, athlete_id, registration_source)
  values (p_tryout_id, v_share.athlete_id, 'manual')
  returning id into v_participant_id;

  update public.athlete_shares
  set status = 'assigned', assigned_tryout_id = p_tryout_id,
      assigned_athlete_id = v_share.athlete_id, assigned_participant_id = v_participant_id
  where id = p_share_id
  returning * into v_share;

  update public.athlete_shares
  set status = 'withdrawn'
  where athlete_id = v_share.athlete_id and id <> p_share_id and status = 'shared';

  return v_share;
end;
$$;
grant execute on function public.accept_athlete_share(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- release_athlete_share_for_participant: also revoke the access grant.
-- Never deletes the athletes row itself — it's shared, not owned, by the
-- releasing account. For legacy (pre-this-migration) copy-based shares, the
-- delete below matches zero rows since no grant was ever created for them —
-- safe no-op, status flip still works.
-- ----------------------------------------------------------------------------
create or replace function public.release_athlete_share_for_participant(p_participant_id uuid)
returns public.athlete_shares
language plpgsql security definer set search_path = public as $$
declare
  v_share public.athlete_shares;
begin
  select * into v_share from public.athlete_shares
    where assigned_participant_id = p_participant_id and status = 'assigned'
    for update;

  if v_share.id is null then
    return null;
  end if;

  if not public.can_access_tryout(v_share.assigned_tryout_id) then
    raise exception 'Not authorized to release this share';
  end if;

  update public.athlete_shares set status = 'released' where id = v_share.id returning * into v_share;

  delete from public.athlete_account_access
  where athlete_id = v_share.athlete_id and account_id = v_share.coach_account_id;

  return v_share;
end;
$$;
grant execute on function public.release_athlete_share_for_participant(uuid) to authenticated;
