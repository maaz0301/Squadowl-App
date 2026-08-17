-- Club plan ships with 6 teams included; teams beyond that are sold as add-on
-- licenses at CAD$10/team/year. This column holds how many extra team licenses
-- the account has paid for; the team cap is (plan included teams + this).
--
-- Only tiers that sell the add-on (Club) widen their cap with it — see
-- getTeamAllowance() in src/data/plans.ts — so a leftover count on an account
-- that later downgrades does not grant extra teams on the lower plan.
alter table public.accounts
  add column if not exists extra_team_licenses integer not null default 0;

alter table public.accounts
  drop constraint if exists accounts_extra_team_licenses_non_negative;

alter table public.accounts
  add constraint accounts_extra_team_licenses_non_negative
  check (extra_team_licenses >= 0);

comment on column public.accounts.extra_team_licenses is
  'Add-on team licenses purchased beyond the plan''s included teams (Club: CAD$10/team/year).';

-- One row per completed add-on checkout. The Stripe session id is the primary key so a
-- redelivered checkout.session.completed webhook (Stripe retries on any non-2xx, and can
-- deliver the same event twice) can't grant the same teams a second time.
create table if not exists public.team_license_purchases (
  stripe_session_id      text primary key,
  account_id             uuid not null references public.accounts(id) on delete cascade,
  quantity               integer not null check (quantity > 0),
  -- The add-on's own Stripe subscription (separate from the account's plan
  -- subscription), so cancelling it can hand the teams back.
  stripe_subscription_id text,
  created_at             timestamptz not null default now()
);

create index if not exists team_license_purchases_account_idx
  on public.team_license_purchases (account_id, created_at desc);

create index if not exists team_license_purchases_subscription_idx
  on public.team_license_purchases (stripe_subscription_id);

alter table public.team_license_purchases enable row level security;

-- Account members can see what they bought; only the webhook (service role, which
-- bypasses RLS) ever writes rows.
drop policy if exists team_license_purchases_read on public.team_license_purchases;
create policy team_license_purchases_read on public.team_license_purchases
  for select using (public.has_account_access(account_id));

-- Atomic grant: records the purchase and bumps the cap in one statement so two
-- concurrent webhook deliveries can't both read-then-write the same starting value.
-- Returns the new license total, or null when the session was already processed.
create or replace function public.grant_team_licenses(
  p_account_id uuid,
  p_session_id text,
  p_quantity integer,
  p_subscription_id text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  insert into public.team_license_purchases (stripe_session_id, account_id, quantity, stripe_subscription_id)
  values (p_session_id, p_account_id, p_quantity, p_subscription_id)
  on conflict (stripe_session_id) do nothing;

  if not found then
    return null;
  end if;

  update public.accounts
     set extra_team_licenses = extra_team_licenses + p_quantity
   where id = p_account_id
  returning extra_team_licenses into v_total;

  return v_total;
end;
$$;

-- Cancelling the add-on subscription hands the teams back. Deleting the purchase rows
-- makes this idempotent: a redelivered cancellation finds nothing left to revoke.
-- Existing teams over the new cap are left alone — the coach just can't create more.
create or replace function public.revoke_team_licenses(p_subscription_id text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_account_id uuid;
  v_quantity   integer;
  v_total      integer;
begin
  select account_id, sum(quantity)::integer
    into v_account_id, v_quantity
    from public.team_license_purchases
   where stripe_subscription_id = p_subscription_id
   group by account_id;

  if v_account_id is null then
    return null;
  end if;

  delete from public.team_license_purchases where stripe_subscription_id = p_subscription_id;

  update public.accounts
     set extra_team_licenses = greatest(0, extra_team_licenses - v_quantity)
   where id = v_account_id
  returning extra_team_licenses into v_total;

  return v_total;
end;
$$;

revoke all on function public.grant_team_licenses(uuid, text, integer, text) from public;
revoke all on function public.grant_team_licenses(uuid, text, integer, text) from anon, authenticated;
grant execute on function public.grant_team_licenses(uuid, text, integer, text) to service_role;

revoke all on function public.revoke_team_licenses(text) from public;
revoke all on function public.revoke_team_licenses(text) from anon, authenticated;
grant execute on function public.revoke_team_licenses(text) to service_role;
