-- Founder search: % and _ typed in the box are now matched literally instead of acting as LIKE
-- wildcards (searching '%' matched every account, and 'a_b' also matched 'aXb'). Backslash is
-- escaped first, then % and _, and the pattern is built from the escaped text.
-- Same definitions as 20260930160000 (organizations) and 20261001160000 (users) otherwise.

-- Founder Console: search matches any member's email, and an organization with no owner
-- shows its first non-guardian member (coach/admin) instead of 'No owner'.
CREATE OR REPLACE FUNCTION public.founder_list_organizations(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_include_individual boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name text, account_type text, plan_tier text, subscription_status text, access_status text, suspended_at timestamp with time zone, suspended_reason text, trial_ends_at timestamp with time zone, is_comp boolean, owner_email text, member_count integer, team_count integer, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with filtered as (
    select a.*, public.account_access_status(a) as status
      from public.accounts a
     where not a.hidden_from_founder
       and (p_include_individual or a.type = 'organization')
       and (q is null
            or a.name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or exists (select 1
                         from public.memberships m
                         join public.profiles p on p.id = m.user_id
                        where m.account_id = a.id
                          and p.email ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
  ),
  page as (
    select f.*, count(*) over () as total
      from filtered f
     where p_status is null or f.status = p_status
     order by f.created_at desc, f.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select pg.id,
         pg.name,
         pg.type::text,
         pg.plan_tier::text,
         pg.subscription_status::text,
         pg.status,
         pg.suspended_at,
         pg.suspended_reason,
         pg.trial_ends_at,
         pg.is_comp,
         o.email::text,
         coalesce(mc.n, 0)::int,
         coalesce(tc.n, 0)::int,
         pg.created_at,
         pg.total
    from page pg
    left join lateral (
      select p.email
        from public.memberships m
        join public.profiles p on p.id = m.user_id
       where m.account_id = pg.id and m.role::text <> 'guardian'
       order by (m.role = 'owner') desc, m.created_at
       limit 1
    ) o on true
    left join lateral (select count(*) as n from public.memberships m where m.account_id = pg.id) mc on true
    left join lateral (select count(*) as n from public.teams t where t.account_id = pg.id and not t.archived) tc on true
   order by pg.created_at desc, pg.id;
end;
$function$;

-- Follow-up to 20261001140000: searching on the All tab could not find a login with no organization
-- (search 'zoe.lopez.3' returned nothing on All). While a search is running, All now includes them.
-- Users page: separate people who belong to an organization from the ~41,000 auto-created
-- guardian logins (yopmail / example.com) that belong to none.
--   p_role null    (the "All" tab)        -> only logins with at least one membership,
--                                              except while searching, so a search still finds anyone
--   p_role 'none'  (the "No organization" tab) -> only logins with no membership
--   any other role                         -> unchanged
-- Hidden-account filtering from 20260930150000 is kept as is.
CREATE OR REPLACE FUNCTION public.founder_list_users(p_search text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, email text, display_name text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, email_confirmed_at timestamp with time zone, banned_until timestamp with time zone, memberships jsonb, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with base as (
    select p.id, p.email, p.display_name, u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.banned_until
      from public.profiles p
      join auth.users u on u.id = p.id
     where not (
             exists (select 1 from public.memberships hm join public.accounts ha on ha.id = hm.account_id
                      where hm.user_id = p.id and ha.hidden_from_founder)
             and not exists (select 1 from public.memberships vm join public.accounts va on va.id = vm.account_id
                              where vm.user_id = p.id and not va.hidden_from_founder))
       and (q is null
            or p.email ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or p.display_name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or exists (select 1
                         from public.memberships m
                         join public.accounts a on a.id = m.account_id
                        where m.user_id = p.id and a.name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
       and (case
              when p_role = 'none' then not exists (select 1 from public.memberships nm where nm.user_id = p.id)
              when p_role is null and p_account_id is null and q is null then exists (select 1 from public.memberships nm where nm.user_id = p.id)
              else true
            end)
       and (p_account_id is null or exists (
             select 1 from public.memberships m where m.user_id = p.id and m.account_id = p_account_id))
       and (p_role is null or p_role = 'none' or exists (
             select 1 from public.memberships m where m.user_id = p.id and m.role::text = p_role))
  ),
  page as (
    select b.*, count(*) over () as total
      from base b
     order by b.created_at desc, b.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select pg.id,
         pg.email::text,
         pg.display_name,
         pg.created_at,
         pg.last_sign_in_at,
         pg.email_confirmed_at,
         pg.banned_until,
         coalesce(mj.memberships, '[]'::jsonb),
         pg.total
    from page pg
    left join lateral (
      select jsonb_agg(
               jsonb_build_object('accountId', m.account_id, 'accountName', a.name, 'role', m.role)
               order by a.name
             ) as memberships
        from public.memberships m
        join public.accounts a on a.id = m.account_id
       where m.user_id = pg.id
    ) mj on true
   order by pg.created_at desc, pg.id;
end;
$function$;
