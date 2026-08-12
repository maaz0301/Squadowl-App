-- tryout_assessors_write (0001_initial_schema.sql) only lets account staff
-- (owner/admin/coach) write to this table — can_manage_tryout deliberately
-- excludes assessors, since the table also holds invite metadata. That means
-- an assessor's own UPDATE to accept/decline their invite matches zero rows
-- under RLS and silently no-ops (no error, no change — this is why Accept
-- and Decline appeared to do nothing). Route status changes through a
-- SECURITY DEFINER function scoped to the caller's own row instead of
-- opening up table-level write access to assessors.
create or replace function public.set_assessor_status(p_tryout_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('accepted', 'declined') then
    raise exception 'Invalid assessor status: %', p_status;
  end if;

  update public.tryout_assessors
     set status = p_status
   where tryout_id = p_tryout_id
     and user_id = auth.uid();

  if not found then
    raise exception 'No assessor invite found for this user on this tryout';
  end if;
end;
$$;

grant execute on function public.set_assessor_status(uuid, text) to authenticated;
