create or replace function public.can_access_athlete(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
      or at.guardian_user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.tryout_participants tp
    where tp.athlete_id = a and public.can_access_tryout(tp.tryout_id)
  );
$$;
