-- ============================================================================
-- Athlete Assessment Systems — Foundational Schema (migration 0001)
-- ----------------------------------------------------------------------------
-- Design decisions locked with product owner (2026-06-23):
--   1. Tenancy   : every signup gets an `account` (type = individual | organization).
--                  Solo coach = account of one; association = many members. Same table.
--   2. Athlete   : canonical person, ACCOUNT-SCOPED. Same kid in two accounts = two rows.
--                  Participation in an event is a separate row (tryout_participants / season_roster).
--   3. Storage   : big collections are relational tables; config/AI output stays JSONB.
--   4. Roles     : owner / admin / coach / assessor / guardian. Assessors & guardians log in.
--   5. Scoring   : normalized `evaluation_scores` rows (queryable for analytics/AI).
--   6. Billing   : subscription lives on the ACCOUNT, not the user.
-- ============================================================================

create extension if not exists pgcrypto;       -- gen_random_uuid()
create extension if not exists citext;          -- case-insensitive email

-- ─── Enums ──────────────────────────────────────────────────────────────────
create type account_type        as enum ('individual', 'organization');
create type membership_role      as enum ('owner', 'admin', 'coach', 'assessor', 'guardian');
create type plan_tier            as enum ('free', 'coach', 'club', 'pro', 'association');
create type subscription_status  as enum ('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete');
create type event_type           as enum ('tryout', 'assessment', 'sort_out', 'combine');
create type assessor_role        as enum ('lead', 'assistant', 'assessor');
create type recommendation       as enum ('make', 'keep', 'bubble', 'release');
create type registration_status  as enum ('pending', 'added', 'dismissed');
create type registration_payment as enum ('paid', 'partial', 'unpaid');
create type registration_source  as enum ('manual', 'qr', 'import');
create type evaluation_source    as enum ('manual', 'scan');
create type season_event_kind    as enum ('game', 'practice', 'event');
create type availability_option  as enum ('yes', 'maybe', 'no', 'pending');
create type payment_status       as enum ('paid', 'pending', 'refunded');
create type ai_kind              as enum ('player_summary', 'compare');

-- ─── updated_at helper ────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- IDENTITY & TENANCY
-- ============================================================================

-- Tenant. Owns ALL data and holds the subscription.
create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  type                  account_type not null default 'individual',
  name                  text not null,
  slug                  citext unique,                 -- only meaningful for organizations
  sport                 text,                          -- primary sport (orgs)
  plan_tier             plan_tier not null default 'free',
  subscription_status   subscription_status not null default 'none',
  stripe_customer_id    text,
  stripe_subscription_id text,
  current_period_end    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One row per Supabase auth user.
create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 citext not null,
  display_name          text not null,
  onboarding_completed  boolean not null default false,
  onboarding_steps      jsonb not null default '{
    "createTeam": false, "createAssessment": false, "inviteAssessors": false,
    "addPlayers": false, "scorePlayers": false
  }'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- A user's role within an account. A user may belong to several accounts.
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        membership_role not null default 'coach',
  created_at  timestamptz not null default now(),
  unique (account_id, user_id)
);
create index idx_memberships_user on public.memberships(user_id);
create index idx_memberships_account on public.memberships(account_id);

-- Cross-account super admins (platform operators).
create table public.platform_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ORG STRUCTURE
-- ============================================================================

create table public.teams (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  name         text not null,
  season_label text,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_teams_account on public.teams(account_id);

-- Canonical athlete. Account-scoped (privacy/data ownership).
create table public.athletes (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  first_name        text not null,
  last_name         text not null,
  year_of_birth     int,
  default_position  text,
  guardian_name     text,
  guardian_email    citext,
  guardian_phone    text,
  guardian_user_id  uuid references public.profiles(id) on delete set null, -- set when guardian signs up
  medical_info      text,
  about             text,
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_athletes_account on public.athletes(account_id);
create index idx_athletes_guardian on public.athletes(guardian_user_id);

-- ============================================================================
-- SEASONS / TEAM HUB
-- ============================================================================

create table public.seasons (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  team_id              uuid references public.teams(id) on delete set null,
  name                 text not null,
  team_name            text not null,
  sport                text not null default 'Hockey',
  year                 text,
  division             text,
  coach                text,
  schedule_share_token text unique,            -- public guardian schedule link
  archived             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index idx_seasons_account on public.seasons(account_id);

create table public.season_events (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references public.seasons(id) on delete cascade,
  kind        season_event_kind not null default 'game',
  title       text not null,
  event_date  date not null,
  start_time  text,
  end_time    text,
  location    text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_season_events_season on public.season_events(season_id);

-- An athlete's enrollment in a season (reuses canonical athlete).
create table public.season_roster (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references public.seasons(id) on delete cascade,
  athlete_id   uuid not null references public.athletes(id) on delete cascade,
  jersey       text,
  player_email citext,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (season_id, athlete_id)
);
create index idx_season_roster_season on public.season_roster(season_id);
create index idx_season_roster_athlete on public.season_roster(athlete_id);

-- RSVP (normalized from the old JSON availability map).
create table public.event_availability (
  id              uuid primary key default gen_random_uuid(),
  season_event_id uuid not null references public.season_events(id) on delete cascade,
  roster_id       uuid not null references public.season_roster(id) on delete cascade,
  response        availability_option not null default 'pending',
  responded_by    uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now(),
  unique (season_event_id, roster_id)
);
create index idx_event_availability_event on public.event_availability(season_event_id);

-- Guardian portal invites.
create table public.portal_invites (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  athlete_id       uuid not null references public.athletes(id) on delete cascade,
  season_id        uuid references public.seasons(id) on delete cascade,
  email            citext not null,
  token            text not null unique,
  sent_at          timestamptz not null default now(),
  accepted_at      timestamptz,
  accepted_user_id uuid references public.profiles(id) on delete set null
);
create index idx_portal_invites_athlete on public.portal_invites(athlete_id);

-- ============================================================================
-- TRYOUTS / ASSESSMENTS
-- ============================================================================

create table public.tryouts (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  team_id             uuid references public.teams(id) on delete set null,
  season_id           uuid references public.seasons(id) on delete set null,
  name                text not null,
  event_type          event_type not null default 'tryout',
  sport               text not null default 'Hockey',
  sport_other         text,
  tryout_date         date,
  start_time          text,
  location            text,                  -- formerly "rink"
  default_position    text,
  head_coach          text,
  head_assessor       text,
  -- weights + customRubrics stay as config:
  settings            jsonb not null default '{"skaterWeights":{}, "goalieWeights":{}, "customRubrics":[]}'::jsonb,
  registration_code   text unique,           -- public QR/registration code
  registration_open   boolean not null default false,
  ai_assessments      jsonb,                 -- cached AI output (optional)
  archived            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_tryouts_account on public.tryouts(account_id);
create index idx_tryouts_team on public.tryouts(team_id);

-- Assessors invited to a tryout. Supports invite-before-signup (user_id null until accepted).
create table public.tryout_assessors (
  id          uuid primary key default gen_random_uuid(),
  tryout_id   uuid not null references public.tryouts(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  name        text not null,
  email       citext,
  role        assessor_role not null default 'assessor',
  invite_token text unique,
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,
  unique (tryout_id, email)
);
create index idx_tryout_assessors_tryout on public.tryout_assessors(tryout_id);
create index idx_tryout_assessors_user on public.tryout_assessors(user_id);

-- An athlete's participation in a tryout (replaces the embedded roster Player).
create table public.tryout_participants (
  id                    uuid primary key default gen_random_uuid(),
  tryout_id             uuid not null references public.tryouts(id) on delete cascade,
  athlete_id            uuid not null references public.athletes(id) on delete cascade,
  jersey                text,
  jersey_colour         text,
  position              text,
  shoots                text,
  position_trying_out_for text,
  current_team          text,
  current_level         text,
  assigned_assessor_id  uuid references public.tryout_assessors(id) on delete set null,
  registration_source   registration_source not null default 'manual',
  anonymous             boolean not null default false,
  sort_out              boolean not null default false,
  waiver_accepted_at    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tryout_id, athlete_id)
);
create index idx_participants_tryout on public.tryout_participants(tryout_id);
create index idx_participants_athlete on public.tryout_participants(athlete_id);

create table public.evaluations (
  id                uuid primary key default gen_random_uuid(),
  tryout_id         uuid not null references public.tryouts(id) on delete cascade,
  participant_id    uuid not null references public.tryout_participants(id) on delete cascade,
  evaluator_user_id uuid references public.profiles(id) on delete set null,
  evaluator_name    text not null,
  session           text not null default 'Session 1',
  strengths         text,
  improve           text,
  recommendation    recommendation,
  source            evaluation_source not null default 'manual',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_evaluations_tryout on public.evaluations(tryout_id);
create index idx_evaluations_participant on public.evaluations(participant_id);

-- Normalized scores: one row per rubric category per evaluation.
create table public.evaluation_scores (
  id            uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  rubric_key    text not null,
  value         numeric not null,
  unique (evaluation_id, rubric_key)
);
create index idx_eval_scores_eval on public.evaluation_scores(evaluation_id);

-- Inbound registrations (before becoming participants).
create table public.registrations (
  id                      uuid primary key default gen_random_uuid(),
  tryout_id               uuid not null references public.tryouts(id) on delete cascade,
  athlete_id              uuid references public.athletes(id) on delete set null, -- set on conversion
  first_name              text not null,
  last_name               text not null,
  year_of_birth           int,
  position_trying_out_for text,
  guardian_name           text not null,
  guardian_email          citext not null,
  guardian_phone          text,
  current_team            text,
  current_level           text,
  about_player            text,
  medical_info            text,
  friend1_name            text,
  friend2_name            text,
  status                  registration_status not null default 'pending',
  payment_status          registration_payment,
  created_at              timestamptz not null default now()
);
create index idx_registrations_tryout on public.registrations(tryout_id);

-- Friend grouping for Team Builder (relational instead of JSON).
create table public.friend_packages (
  id          uuid primary key default gen_random_uuid(),
  tryout_id   uuid not null references public.tryouts(id) on delete cascade,
  name        text not null,
  highlighted boolean not null default false,
  created_at  timestamptz not null default now()
);
create table public.friend_package_members (
  package_id     uuid not null references public.friend_packages(id) on delete cascade,
  participant_id uuid not null references public.tryout_participants(id) on delete cascade,
  primary key (package_id, participant_id)
);

-- ============================================================================
-- BILLING
-- ============================================================================

create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id) on delete cascade,
  tryout_id                uuid references public.tryouts(id) on delete set null,
  athlete_id               uuid references public.athletes(id) on delete set null,
  registration_id          uuid references public.registrations(id) on delete set null,
  amount_cents             int not null,
  currency                 text not null default 'usd',
  status                   payment_status not null default 'pending',
  stripe_payment_intent_id text,
  received_at              timestamptz,
  created_at               timestamptz not null default now()
);
create index idx_payments_account on public.payments(account_id);

-- ============================================================================
-- updated_at triggers
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','profiles','teams','athletes','seasons','season_events',
    'season_roster','tryouts','tryout_participants','evaluations'
  ] loop
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$s
       for each row execute function public.set_updated_at();', t);
  end loop;
end$$;

-- ============================================================================
-- New-user bootstrap: profile + personal account + owner membership
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_account_id uuid;
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );

  insert into public.accounts (type, name, plan_tier)
  values ('individual',
          coalesce(new.raw_user_meta_data->>'display_name', 'My Account'),
          'free')
  returning id into new_account_id;

  insert into public.memberships (account_id, user_id, role)
  values (new_account_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================================
-- RLS HELPER FUNCTIONS
-- ============================================================================
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function public.has_account_access(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.memberships m
                 where m.user_id = auth.uid() and m.account_id = target);
$$;

create or replace function public.has_account_role(target uuid, roles membership_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.memberships m
                 where m.user_id = auth.uid()
                   and m.account_id = target
                   and m.role = any(roles));
$$;

-- Coaches/admins/owners of the tryout's account, OR an assessor invited to it.
create or replace function public.can_access_tryout(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tryouts ty where ty.id = t and (
      public.has_account_role(ty.account_id, array['owner','admin','coach']::membership_role[])
      or exists (select 1 from public.tryout_assessors ta
                 where ta.tryout_id = t and ta.user_id = auth.uid())
    )
  );
$$;

-- Manage = account staff only (excludes assessors). Used for sensitive PII (registrations).
create or replace function public.can_manage_tryout(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tryouts ty where ty.id = t
      and public.has_account_role(ty.account_id, array['owner','admin','coach']::membership_role[])
  );
$$;

-- Account staff OR the athlete's linked guardian.
create or replace function public.can_access_athlete(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
      or at.guardian_user_id = auth.uid()
    )
  );
$$;

-- Account staff OR a guardian who has an athlete on this season's roster.
create or replace function public.can_access_season(s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.seasons se where se.id = s and (
      public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
      or exists (
        select 1 from public.season_roster sr
        join public.athletes at on at.id = sr.athlete_id
        where sr.season_id = s and at.guardian_user_id = auth.uid()
      )
    )
  );
$$;

-- ============================================================================
-- ENABLE RLS + POLICIES
-- ----------------------------------------------------------------------------
-- NOTE: these are the foundational policies. Tighten/extend per endpoint as flows land.
-- ============================================================================

alter table public.accounts            enable row level security;
alter table public.profiles            enable row level security;
alter table public.memberships         enable row level security;
alter table public.platform_admins     enable row level security;
alter table public.teams               enable row level security;
alter table public.athletes            enable row level security;
alter table public.seasons             enable row level security;
alter table public.season_events       enable row level security;
alter table public.season_roster       enable row level security;
alter table public.event_availability  enable row level security;
alter table public.portal_invites      enable row level security;
alter table public.tryouts             enable row level security;
alter table public.tryout_assessors    enable row level security;
alter table public.tryout_participants enable row level security;
alter table public.evaluations         enable row level security;
alter table public.evaluation_scores   enable row level security;
alter table public.registrations       enable row level security;
alter table public.friend_packages     enable row level security;
alter table public.friend_package_members enable row level security;
alter table public.payments            enable row level security;

-- profiles: a user sees/edits their own profile.
create policy profiles_self on public.profiles
  for all using (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid());

-- accounts: members can read; owners/admins can update.
create policy accounts_read on public.accounts
  for select using (public.has_account_access(id));
create policy accounts_update on public.accounts
  for update using (public.has_account_role(id, array['owner','admin']::membership_role[]));

-- memberships: members read their account's memberships; owners/admins manage.
create policy memberships_read on public.memberships
  for select using (public.has_account_access(account_id));
create policy memberships_write on public.memberships
  for all using (public.has_account_role(account_id, array['owner','admin']::membership_role[]))
  with check (public.has_account_role(account_id, array['owner','admin']::membership_role[]));

-- platform_admins: only platform admins.
create policy platform_admins_read on public.platform_admins
  for select using (public.is_platform_admin());

-- Generic account-scoped tables (staff full access).
create policy teams_rw on public.teams
  for all using (public.has_account_access(account_id))
  with check (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

create policy athletes_read on public.athletes
  for select using (public.can_access_athlete(id));
create policy athletes_write on public.athletes
  for all using (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]))
  with check (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

-- Seasons (guardians get read via roster).
create policy seasons_read on public.seasons
  for select using (public.can_access_season(id));
create policy seasons_write on public.seasons
  for all using (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]))
  with check (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

create policy season_events_read on public.season_events
  for select using (public.can_access_season(season_id));
create policy season_events_write on public.season_events
  for all using (exists (select 1 from public.seasons se where se.id = season_id
                         and public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])))
  with check (exists (select 1 from public.seasons se where se.id = season_id
                      and public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])));

create policy season_roster_read on public.season_roster
  for select using (public.can_access_season(season_id));
create policy season_roster_write on public.season_roster
  for all using (exists (select 1 from public.seasons se where se.id = season_id
                         and public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])))
  with check (exists (select 1 from public.seasons se where se.id = season_id
                      and public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])));

-- Availability: staff manage; guardians may set their own athlete's response.
create policy availability_read on public.event_availability
  for select using (exists (select 1 from public.season_events ev where ev.id = season_event_id
                            and public.can_access_season(ev.season_id)));
create policy availability_write on public.event_availability
  for all using (
    exists (select 1 from public.season_roster sr join public.athletes at on at.id = sr.athlete_id
            where sr.id = roster_id and at.guardian_user_id = auth.uid())
    or exists (select 1 from public.season_events ev join public.seasons se on se.id = ev.season_id
               where ev.id = season_event_id
               and public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[]))
  )
  with check (true);

create policy portal_invites_rw on public.portal_invites
  for all using (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]))
  with check (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

-- Tryouts: assessors get read; staff manage.
create policy tryouts_read on public.tryouts
  for select using (public.can_access_tryout(id));
create policy tryouts_write on public.tryouts
  for all using (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]))
  with check (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

create policy tryout_assessors_read on public.tryout_assessors
  for select using (public.can_access_tryout(tryout_id));
create policy tryout_assessors_write on public.tryout_assessors
  for all using (public.can_manage_tryout(tryout_id))
  with check (public.can_manage_tryout(tryout_id));

create policy participants_read on public.tryout_participants
  for select using (public.can_access_tryout(tryout_id));
create policy participants_write on public.tryout_participants
  for all using (public.can_access_tryout(tryout_id))
  with check (public.can_access_tryout(tryout_id));

-- Evaluations: any assessor on the tryout can read/write; restrict edits to author or staff at the app layer.
create policy evaluations_read on public.evaluations
  for select using (public.can_access_tryout(tryout_id));
create policy evaluations_write on public.evaluations
  for all using (public.can_access_tryout(tryout_id))
  with check (public.can_access_tryout(tryout_id));

create policy eval_scores_rw on public.evaluation_scores
  for all using (exists (select 1 from public.evaluations e where e.id = evaluation_id
                         and public.can_access_tryout(e.tryout_id)))
  with check (exists (select 1 from public.evaluations e where e.id = evaluation_id
                      and public.can_access_tryout(e.tryout_id)));

-- Registrations carry guardian PII → staff only (no assessors).
create policy registrations_rw on public.registrations
  for all using (public.can_manage_tryout(tryout_id))
  with check (public.can_manage_tryout(tryout_id));

create policy friend_packages_rw on public.friend_packages
  for all using (public.can_access_tryout(tryout_id))
  with check (public.can_manage_tryout(tryout_id));
create policy friend_package_members_rw on public.friend_package_members
  for all using (exists (select 1 from public.friend_packages fp where fp.id = package_id
                         and public.can_access_tryout(fp.tryout_id)))
  with check (exists (select 1 from public.friend_packages fp where fp.id = package_id
                      and public.can_manage_tryout(fp.tryout_id)));

create policy payments_read on public.payments
  for select using (public.has_account_role(account_id, array['owner','admin']::membership_role[]));
create policy payments_write on public.payments
  for all using (public.has_account_role(account_id, array['owner','admin']::membership_role[]))
  with check (public.has_account_role(account_id, array['owner','admin']::membership_role[]));

-- NOTE: public registration submit & public schedule/RSVP links are intentionally
-- NOT covered by these authenticated policies — they run through edge functions /
-- the service role (no user session). Locked down separately in migration 0002.
