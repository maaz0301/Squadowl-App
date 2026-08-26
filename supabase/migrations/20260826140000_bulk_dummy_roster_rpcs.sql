-- ============================================================================
-- Bulk RPCs for the dummy-data roster insert.
-- ----------------------------------------------------------------------------
-- insertDummyRoster() bulk-inserts tryout_participants, evaluations and
-- evaluation_scores directly, which runs under the `authenticated` role
-- (statement_timeout = 8s). Each inserted row re-evaluates the table's RLS
-- `with check` — can_access_tryout(), which itself calls has_account_role()
-- and up to two more EXISTS subqueries — so a 1000-player x 5-session batch
-- (5,000 evaluation rows, tens of thousands of score rows, all for the same
-- tryout) pays that check once per row instead of once for the whole batch.
-- That's exactly what produced "canceling statement due to statement timeout"
-- once a batch got large enough.
--
-- These mirror create_athletes_for_caller(): one authorization check via
-- can_access_tryout(), then a set-based insert as `postgres` (which has
-- bypassrls), so the per-row RLS cost disappears entirely regardless of batch
-- size.
-- ============================================================================

create or replace function public.insert_tryout_participants_for_caller(p_tryout_id uuid, participants jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if not public.can_access_tryout(p_tryout_id) then
    raise exception 'Not authorized for this tryout';
  end if;

  if participants is null or jsonb_typeof(participants) <> 'array' then
    raise exception 'participants must be a jsonb array';
  end if;

  if jsonb_array_length(participants) = 0 then
    return array[]::uuid[];
  end if;

  with input as (
    select ord, elem, gen_random_uuid() as id
    from jsonb_array_elements(participants) with ordinality as t(elem, ord)
  ),
  ins as (
    insert into public.tryout_participants (
      id, tryout_id, athlete_id, jersey, position, current_team, current_level, registration_source
    )
    select
      i.id,
      p_tryout_id,
      (i.elem->>'athlete_id')::uuid,
      nullif(i.elem->>'jersey', ''),
      nullif(i.elem->>'position', ''),
      nullif(i.elem->>'current_team', ''),
      nullif(i.elem->>'current_level', ''),
      coalesce(nullif(i.elem->>'registration_source', ''), 'manual')::registration_source
    from input i
    returning id
  )
  select array_agg(i.id order by i.ord) into v_ids from input i;

  return v_ids;
end;
$$;

revoke execute on function public.insert_tryout_participants_for_caller(uuid, jsonb) from public;
grant execute on function public.insert_tryout_participants_for_caller(uuid, jsonb) to authenticated;

create or replace function public.insert_evaluations_for_caller(p_tryout_id uuid, rows jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if not public.can_access_tryout(p_tryout_id) then
    raise exception 'Not authorized for this tryout';
  end if;

  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a jsonb array';
  end if;

  if jsonb_array_length(rows) = 0 then
    return array[]::uuid[];
  end if;

  -- Every participant referenced must actually belong to this tryout — the
  -- RLS check this RPC bypasses would otherwise have caught a row aimed at
  -- someone else's roster via the plain evaluations_write policy.
  if exists (
    select 1
    from jsonb_array_elements(rows) as elem
    where not exists (
      select 1 from public.tryout_participants tp
      where tp.id = (elem->>'participant_id')::uuid and tp.tryout_id = p_tryout_id
    )
  ) then
    raise exception 'One or more participants do not belong to this tryout';
  end if;

  with input as (
    select ord, elem, gen_random_uuid() as id
    from jsonb_array_elements(rows) with ordinality as t(elem, ord)
  ),
  ins as (
    insert into public.evaluations (
      id, tryout_id, participant_id, evaluator_user_id, evaluator_name, session, recommendation, source
    )
    select
      i.id,
      p_tryout_id,
      (i.elem->>'participant_id')::uuid,
      nullif(i.elem->>'evaluator_user_id', '')::uuid,
      i.elem->>'evaluator_name',
      coalesce(nullif(i.elem->>'session', ''), 'Session 1'),
      nullif(i.elem->>'recommendation', '')::recommendation,
      coalesce(nullif(i.elem->>'source', ''), 'manual')::evaluation_source
    from input i
    returning id
  )
  select array_agg(i.id order by i.ord) into v_ids from input i;

  return v_ids;
end;
$$;

revoke execute on function public.insert_evaluations_for_caller(uuid, jsonb) from public;
grant execute on function public.insert_evaluations_for_caller(uuid, jsonb) to authenticated;

create or replace function public.insert_evaluation_scores_for_caller(p_tryout_id uuid, rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access_tryout(p_tryout_id) then
    raise exception 'Not authorized for this tryout';
  end if;

  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a jsonb array';
  end if;

  if jsonb_array_length(rows) = 0 then
    return;
  end if;

  -- Every evaluation referenced must actually belong to this tryout — same
  -- reasoning as insert_evaluations_for_caller.
  if exists (
    select 1
    from jsonb_array_elements(rows) as elem
    where not exists (
      select 1 from public.evaluations e
      where e.id = (elem->>'evaluation_id')::uuid and e.tryout_id = p_tryout_id
    )
  ) then
    raise exception 'One or more evaluations do not belong to this tryout';
  end if;

  insert into public.evaluation_scores (evaluation_id, rubric_key, value)
  select
    (elem->>'evaluation_id')::uuid,
    elem->>'rubric_key',
    (elem->>'value')::numeric
  from jsonb_array_elements(rows) as elem;
end;
$$;

revoke execute on function public.insert_evaluation_scores_for_caller(uuid, jsonb) from public;
grant execute on function public.insert_evaluation_scores_for_caller(uuid, jsonb) to authenticated;
