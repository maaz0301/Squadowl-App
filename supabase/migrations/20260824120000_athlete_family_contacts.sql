-- ============================================================================
-- Additional family contacts on an athlete's profile
-- ----------------------------------------------------------------------------
-- Feedback from a coach testing the guardian portal: once a player is added,
-- the primary guardian should be able to add other family members (a second
-- parent, a grandparent, an emergency contact) to that athlete's profile —
-- info coaches/staff can see but the guardian manages themselves.
--
-- The athlete row only ever carried one guardian_name/email/phone, and
-- guardians have no write access to `athletes` at all under RLS (athletes_write
-- is owner/admin/coach only — see 0001_initial_schema.sql). A second table with
-- its own narrow policy is simpler than trying to carve a column-level
-- exception into that policy, and it lets a family carry more than one extra
-- contact.
-- ============================================================================

create table if not exists public.athlete_family_contacts (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null references public.athletes(id) on delete cascade,
  name         text not null,
  -- Free-form ("Grandmother", "Emergency Contact", ...) rather than an enum —
  -- this is display-only, nothing downstream branches on it.
  relationship text,
  email        text,
  phone        text,
  created_at   timestamptz not null default now(),
  -- Kept for the audit trail; nulled rather than cascaded so a removed staff
  -- account doesn't take the contact down with it.
  created_by   uuid references public.profiles(id) on delete set null
);

create index if not exists idx_athlete_family_contacts_athlete
  on public.athlete_family_contacts(athlete_id);

alter table public.athlete_family_contacts enable row level security;

-- Same bar as athletes_write (owner/admin/coach), widened to also let the
-- athlete's own guardian manage this one table — everything else about the
-- athlete stays staff-only.
create or replace function public.can_edit_athlete_contacts(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      at.guardian_user_id = auth.uid()
      or public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
    )
  );
$$;

drop policy if exists athlete_family_contacts_rw on public.athlete_family_contacts;
create policy athlete_family_contacts_rw on public.athlete_family_contacts
  for all using (public.can_edit_athlete_contacts(athlete_id))
  with check (public.can_edit_athlete_contacts(athlete_id));

grant execute on function public.can_edit_athlete_contacts(uuid) to authenticated;
