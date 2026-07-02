-- ============================================================================
-- Migration 0004 — Check user exists by email RPC
-- ----------------------------------------------------------------------------
-- Allows the client to securely check if an email exists in public.profiles
-- bypassing RLS to prevent adding non-existent users as assessors.
-- ============================================================================

create or replace function public.check_user_exists(lookup_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  email_exists boolean;
begin
  select exists(
    select 1
    from public.profiles
    where lower(email) = lower(lookup_email)
  ) into email_exists;
  
  return email_exists;
end;
$$;
