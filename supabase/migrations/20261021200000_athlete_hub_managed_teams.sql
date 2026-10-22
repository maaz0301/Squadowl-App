-- Athlete Hub: also list the athletes a person can already see through teams they manage and
-- evaluations they run, not only the athletes held by their own account.
--
-- Before, a team manager (for example someone who manages "Star 1 - 4" for a club that is
-- not their own) saw the team's players on the roster screen, but searching the Athlete Hub
-- returned "No matches", because the hub only looked at athletes owned by, or shared with,
-- the caller's own account. The hub now also includes an athlete when:
--   * they are on the roster of a team the caller manages (team_managers), or
--   * they are a participant in an evaluation (tryout) of a team the caller manages, or
--   * they are a participant in an evaluation the caller is an assessor on.
-- Everything else about the function is unchanged: same staff check on p_account_id, same
-- word-by-word partial search, same ordering and paging.

create or replace function public.list_athlete_hub(
  p_account_id uuid,
  p_term text default '',
  p_offset integer default 0,
  p_limit integer default 60
)
returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_term text;
  v_words text[];
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.has_account_role(p_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- LIKE wildcards in what was typed are dropped, not honoured.
  v_term := btrim(regexp_replace(coalesce(p_term, ''), '[%_\\]', '', 'g'));
  -- Every word typed must appear somewhere in the name, guardian or email, in any
  -- order and anywhere in the word, so "ar", "mith jo" and "smith john" all find John Smith.
  v_words := array(select w from unnest(regexp_split_to_array(v_term, '\s+')) w where w <> '' limit 5);

  return query
  select to_jsonb(a)
  from (
    select x.id, x.first_name, x.last_name, x.year_of_birth, x.avatar_url, x.default_position,
           x.guardian_name, x.guardian_email, x.player_email
    from public.athletes x
    where (
        x.account_id = p_account_id
        or exists (select 1 from public.athlete_account_access g where g.athlete_id = x.id and g.account_id = p_account_id)
        -- players on the roster of a team the caller manages
        or exists (
          select 1
          from public.team_roster tr
          join public.team_managers tm on tm.team_id = tr.team_id
          where tr.athlete_id = x.id and tm.user_id = auth.uid()
        )
        -- players in an evaluation of a team the caller manages
        or exists (
          select 1
          from public.tryout_participants tp
          join public.tryouts t on t.id = tp.tryout_id
          join public.team_managers tm on tm.team_id = t.team_id
          where tp.athlete_id = x.id and tm.user_id = auth.uid()
        )
        -- players in an evaluation the caller is an assessor on
        or exists (
          select 1
          from public.tryout_participants tp
          join public.tryout_assessors ta on ta.tryout_id = tp.tryout_id
          where tp.athlete_id = x.id and ta.user_id = auth.uid()
        )
      )
      and not exists (
        select 1 from unnest(v_words) w
        where not (
          coalesce(x.first_name, '') ilike '%' || w || '%'
          or coalesce(x.last_name, '') ilike '%' || w || '%'
          or coalesce(x.guardian_name, '') ilike '%' || w || '%'
          or coalesce(x.guardian_email, '') ilike '%' || w || '%'
          or coalesce(x.player_email, '') ilike '%' || w || '%'
        )
      )
    order by x.first_name, x.last_name, x.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit v_limit + 1
  ) a;
end;
$$;
grant execute on function public.list_athlete_hub(uuid, text, integer, integer) to authenticated;
