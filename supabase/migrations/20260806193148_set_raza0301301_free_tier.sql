-- One-off: move raza0301301@gmail.com's account back to the free tier for testing.
update public.accounts
set plan_tier = 'free'
where id = (
  select a.id
  from public.accounts a
  join public.memberships m on m.account_id = a.id
  join auth.users u on u.id = m.user_id
  where u.email = 'raza0301301@gmail.com'
  order by m.created_at asc
  limit 1
);
