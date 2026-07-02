-- Update can_access_tryout to allow guardians to read tryouts their athletes are participating in.
create or replace function public.can_access_tryout(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tryouts ty where ty.id = t and (
      public.has_account_role(ty.account_id, array['owner','admin','coach']::membership_role[])
      or exists (select 1 from public.tryout_assessors ta
                 where ta.tryout_id = t and ta.user_id = auth.uid())
      or exists (select 1 from public.tryout_participants tp
                 join public.athletes a on a.id = tp.athlete_id
                 where tp.tryout_id = t and a.guardian_user_id = auth.uid())
    )
  );
$$;
