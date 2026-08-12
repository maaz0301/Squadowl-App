-- One-off: move maaz.khan@ccript.com's account back to the free tier for testing.
-- Note: this account has a live Stripe subscription (sub_1U3cA44fH5NdO5ceJp2QeI2I) that
-- this migration does NOT cancel -- only the local plan_tier/subscription_status are reset.
update public.accounts
set plan_tier = 'free', subscription_status = 'none'
where id = (
  select a.id
  from public.accounts a
  join public.memberships m on m.account_id = a.id
  join public.profiles p on p.id = m.user_id
  where lower(p.email) = lower('maaz.khan@ccript.com')
  order by m.created_at asc
  limit 1
);
