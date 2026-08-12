-- Lets a guardian actually pay a team's fee for a season their athlete is on.
-- Fee status lives on season_roster (not team_roster) because that's the row
-- the guardian portal already reads (getGuardianRosters), and a team's fee
-- is meaningfully "per season enrollment" — a team that runs multiple
-- seasons should be able to collect the fee again each season.
alter table public.season_roster
  add column if not exists fee_status text not null default 'unpaid'
  check (fee_status in ('unpaid', 'paid', 'waived'));
-- Lets a repeat "Pay Now" tap reuse an still-open Checkout Session instead of
-- stacking duplicate ones (mirrors registrations.stripe_checkout_session_id).
alter table public.season_roster
  add column if not exists stripe_checkout_session_id text;

-- season_roster_write (staff-only) already governs UPDATE, so a guardian can
-- never flip this themselves — only the service-role webhook (which bypasses
-- RLS) sets it to 'paid' after a real Stripe payment.

-- Mirrors payments.registration_id: a season/team-fee payment has no
-- registration, it's tied straight to the roster row that was paid for.
alter table public.payments
  add column if not exists season_roster_id uuid references public.season_roster(id) on delete set null;
create index if not exists idx_payments_season_roster on public.payments(season_roster_id);
