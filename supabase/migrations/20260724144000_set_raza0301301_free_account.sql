-- Set raza0301301@gmail.com account to free plan tier with subscription_status = 'none'
UPDATE public.accounts
SET plan_tier = 'free', subscription_status = 'none'
WHERE id IN (
  SELECT m.account_id
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE lower(p.email) = lower('raza0301301@gmail.com')
);
