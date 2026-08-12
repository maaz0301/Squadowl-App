-- A team can opt into collecting a registration fee (team/season fees), separate
-- from a tryout's own registrationFeeCents. Charging still goes through the
-- account's Stripe Connect account (accounts.stripe_connect_charges_enabled).
alter table public.teams add column collects_fees boolean not null default false;
alter table public.teams add column registration_fee_cents integer;
