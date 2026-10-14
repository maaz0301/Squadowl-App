-- Security fix: is_founder() answered NULL, not false, for anyone who is not an
-- admin.
--
-- 20261014120000_founder_back_office.sql rewrote it as
--   founder_staff_role() = 'super_admin' and founder_mfa_ok()
-- and founder_staff_role() is NULL for an ordinary user, so the whole expression
-- was NULL. The founder_* functions guard themselves with
--   if not public.is_founder() then raise ...
-- and `not NULL` is NULL, which is not true, so the guard let the caller through.
-- (Row-level-security policies were unaffected: they treat NULL as false.)
-- The edge functions were unaffected too: they require the answer to be true.
--
-- coalesce makes it a real boolean again. is_founder_staff() already was one.

create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(public.founder_staff_role() = 'super_admin', false) and public.founder_mfa_ok();
$$;
