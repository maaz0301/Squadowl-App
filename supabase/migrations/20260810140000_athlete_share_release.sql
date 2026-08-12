-- ============================================================================
-- Releasing a shared+assigned athlete
-- ----------------------------------------------------------------------------
-- When a coach deletes a player from their roster (deletePlayer), and that
-- player was created by accepting a guardian's share, the share should flip
-- to 'released' so the guardian sees the coach let the athlete go — instead
-- of silently staying 'assigned' forever.
-- ============================================================================

alter table public.athlete_shares drop constraint if exists athlete_shares_status_check;
alter table public.athlete_shares add constraint athlete_shares_status_check
  check (status in ('shared','assigned','declined','withdrawn','released'));

-- Called (best-effort) right before deletePlayer removes a tryout_participant.
-- No-op (returns null) if that participant isn't linked to an assigned share.
-- Authorization mirrors the participants_write RLS policy exactly
-- (can_access_tryout: account staff OR an assessor on that tryout) so anyone
-- allowed to delete the participant is also allowed to flip the share status.
create or replace function public.release_athlete_share_for_participant(p_participant_id uuid)
returns public.athlete_shares
language plpgsql security definer set search_path = public as $$
declare
  v_share public.athlete_shares;
begin
  select * into v_share from public.athlete_shares
    where assigned_participant_id = p_participant_id and status = 'assigned'
    for update;

  if v_share.id is null then
    return null;
  end if;

  if not public.can_access_tryout(v_share.assigned_tryout_id) then
    raise exception 'Not authorized to release this share';
  end if;

  update public.athlete_shares set status = 'released' where id = v_share.id returning * into v_share;
  return v_share;
end;
$$;
grant execute on function public.release_athlete_share_for_participant(uuid) to authenticated;
