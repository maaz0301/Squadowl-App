-- ============================================================================
-- Guardian -> Coach athlete profile sharing
-- ----------------------------------------------------------------------------
-- A guardian can share their athlete's basic profile with one or more coaches
-- from a platform-wide directory. Each coach can Accept (placing the athlete
-- into one of their own assessments) or Reject. Athletes are account-scoped
-- (see 0001_initial_schema.sql: "Same kid in two accounts = two rows"), so we
-- never open cross-account reads of tryouts/evaluations for this — instead we
-- snapshot the athlete's profile fields onto the share at share time, and on
-- Accept we copy that snapshot into a brand-new athlete row in the accepting
-- coach's own account (mirroring how addPlayer/createAthlete already work).
-- ============================================================================

create table public.athlete_shares (
  id                      uuid primary key default gen_random_uuid(),
  athlete_id              uuid not null references public.athletes(id) on delete cascade,
  guardian_user_id        uuid not null references public.profiles(id) on delete cascade,
  coach_user_id           uuid not null references public.profiles(id) on delete cascade,
  coach_account_id        uuid not null references public.accounts(id) on delete cascade,
  -- shared = pending coach response; assigned = this coach accepted + placed the athlete;
  -- declined = this coach explicitly rejected; withdrawn = auto-closed because another
  -- coach accepted the same athlete first.
  status                  text not null default 'shared' check (status in ('shared','assigned','declined','withdrawn')),
  -- snapshot of the athlete at share time
  athlete_first_name      text not null,
  athlete_last_name       text not null,
  athlete_avatar_url      text,
  athlete_year_of_birth   int,
  athlete_position        text,
  athlete_guardian_name   text,
  athlete_guardian_email  text,
  athlete_guardian_phone  text,
  athlete_medical_info    text,
  athlete_about           text,
  -- snapshot of the coach at share time (avoids cross-profile RLS reads later)
  coach_display_name      text not null,
  coach_avatar_url        text,
  coach_account_name      text not null,
  coach_sport             text,
  assigned_tryout_id      uuid references public.tryouts(id) on delete set null,
  assigned_athlete_id     uuid references public.athletes(id) on delete set null,
  assigned_participant_id uuid references public.tryout_participants(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (athlete_id, coach_user_id)
);
create index idx_athlete_shares_athlete on public.athlete_shares(athlete_id);
create index idx_athlete_shares_coach_account on public.athlete_shares(coach_account_id);
create index idx_athlete_shares_guardian on public.athlete_shares(guardian_user_id);
create trigger athlete_shares_updated_at before update on public.athlete_shares
  for each row execute function public.set_updated_at();

create table public.athlete_share_comments (
  id              uuid primary key default gen_random_uuid(),
  share_id        uuid not null references public.athlete_shares(id) on delete cascade,
  author_user_id  uuid not null references public.profiles(id) on delete cascade,
  author_name     text not null,
  author_role     text not null check (author_role in ('guardian','coach')),
  body            text not null,
  created_at      timestamptz not null default now()
);
create index idx_athlete_share_comments_share on public.athlete_share_comments(share_id);

alter table public.athlete_shares enable row level security;
alter table public.athlete_share_comments enable row level security;

create policy athlete_shares_select on public.athlete_shares
  for select using (
    guardian_user_id = auth.uid()
    or public.has_account_role(coach_account_id, array['owner','admin','coach']::membership_role[])
  );
create policy athlete_shares_insert on public.athlete_shares
  for insert with check (
    guardian_user_id = auth.uid()
    and exists (select 1 from public.athletes at where at.id = athlete_id and at.guardian_user_id = auth.uid())
  );
-- No general UPDATE policy: status transitions (accept/reject, and the cascading
-- withdraw of sibling shares) only happen through the SECURITY DEFINER functions
-- below, which validate authorization internally and run atomically.

create policy athlete_share_comments_select on public.athlete_share_comments
  for select using (
    exists (select 1 from public.athlete_shares s where s.id = share_id and (
      s.guardian_user_id = auth.uid()
      or public.has_account_role(s.coach_account_id, array['owner','admin','coach']::membership_role[])
    ))
  );
create policy athlete_share_comments_insert on public.athlete_share_comments
  for insert with check (
    author_user_id = auth.uid()
    and exists (select 1 from public.athlete_shares s where s.id = share_id and (
      s.guardian_user_id = auth.uid()
      or public.has_account_role(s.coach_account_id, array['owner','admin','coach']::membership_role[])
    ))
  );

-- Platform-wide coach directory, exposed narrowly (no email) via SECURITY DEFINER
-- so we don't have to loosen RLS on profiles/accounts themselves.
create or replace function public.list_coach_directory()
returns table (
  user_id uuid, display_name text, avatar_url text,
  account_id uuid, account_name text, sport text
) language sql stable security definer set search_path = public as $$
  select distinct on (p.id, a.id) p.id, p.display_name, p.avatar_url, a.id, a.name, a.sport
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  join public.accounts a on a.id = m.account_id
  where m.role in ('owner','admin','coach')
  order by p.id, a.id;
$$;
grant execute on function public.list_coach_directory() to authenticated;

-- Accept: validates the caller is coach/admin/owner on the share's target account,
-- copies the athlete snapshot into that account (createAthlete-equivalent), enrolls
-- them in the chosen tryout, flips this share to 'assigned', and withdraws every
-- other still-pending share for the same athlete — all in one transaction so two
-- coaches can't both win a race to accept the same athlete.
create or replace function public.accept_athlete_share(p_share_id uuid, p_tryout_id uuid)
returns public.athlete_shares
language plpgsql security definer set search_path = public as $$
declare
  v_share public.athlete_shares;
  v_new_athlete_id uuid;
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

  insert into public.athletes (
    account_id, first_name, last_name, year_of_birth, default_position,
    guardian_name, guardian_email, guardian_phone, medical_info, about, avatar_url
  ) values (
    v_share.coach_account_id, v_share.athlete_first_name, v_share.athlete_last_name,
    v_share.athlete_year_of_birth, v_share.athlete_position,
    v_share.athlete_guardian_name, v_share.athlete_guardian_email, v_share.athlete_guardian_phone,
    v_share.athlete_medical_info, v_share.athlete_about, v_share.athlete_avatar_url
  ) returning id into v_new_athlete_id;

  insert into public.tryout_participants (tryout_id, athlete_id, registration_source)
  values (p_tryout_id, v_new_athlete_id, 'manual')
  returning id into v_participant_id;

  update public.athlete_shares
  set status = 'assigned', assigned_tryout_id = p_tryout_id,
      assigned_athlete_id = v_new_athlete_id, assigned_participant_id = v_participant_id
  where id = p_share_id
  returning * into v_share;

  update public.athlete_shares
  set status = 'withdrawn'
  where athlete_id = v_share.athlete_id and id <> p_share_id and status = 'shared';

  return v_share;
end;
$$;
grant execute on function public.accept_athlete_share(uuid, uuid) to authenticated;

create or replace function public.reject_athlete_share(p_share_id uuid)
returns public.athlete_shares
language plpgsql security definer set search_path = public as $$
declare
  v_share public.athlete_shares;
begin
  select * into v_share from public.athlete_shares where id = p_share_id for update;
  if v_share.id is null then
    raise exception 'Share not found';
  end if;
  if not public.has_account_role(v_share.coach_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Not authorized to reject this share';
  end if;
  if v_share.status <> 'shared' then
    raise exception 'Share is no longer pending';
  end if;
  update public.athlete_shares set status = 'declined' where id = p_share_id returning * into v_share;
  return v_share;
end;
$$;
grant execute on function public.reject_athlete_share(uuid) to authenticated;
