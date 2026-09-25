-- One-off: move reachraza150@yopmail.com's account to the free tier for testing.
-- Only the local plan_tier/subscription_status are reset; any Stripe subscription
-- on the account is NOT cancelled by this migration.
update public.accounts
set plan_tier = 'free', subscription_status = 'none'
where id = (
  select a.id
  from public.accounts a
  join public.memberships m on m.account_id = a.id
  join public.profiles p on p.id = m.user_id
  where lower(p.email) = lower('reachraza150@yopmail.com')
  order by m.created_at asc
  limit 1
);
