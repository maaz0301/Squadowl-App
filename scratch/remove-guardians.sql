-- One-off cleanup: strip every guardian contact from the athletes owned by the
-- accounts maaz.khan@ccript.com is staff on.
--
-- Guardians are not rows of their own — they are the guardian_* columns on
-- `athletes`, which is what listOrgMembers() turns into "members". Nulling them
-- clears the directory. Destructive and not reversible: names, emails, phones
-- and the guardian account link are gone for good.
--
-- Run in the Supabase SQL editor (Dashboard → SQL Editor). Steps 1 and 2 are
-- read-only — check what they report before running step 3.

-- ── 1. Which accounts are in scope? ──────────────────────────────────────────
select a.id, a.name, a.type, m.role
from accounts a
join memberships m on m.account_id = a.id
join profiles p on p.id = m.user_id
where p.email = 'maaz.khan@ccript.com'
  and m.role in ('owner', 'admin', 'coach');

-- ── 2. How many athletes would be touched? ───────────────────────────────────
select count(*) as athletes_with_guardian
from athletes ath
where ath.account_id in (
        select m.account_id
        from memberships m
        join profiles p on p.id = m.user_id
        where p.email = 'maaz.khan@ccript.com'
          and m.role in ('owner', 'admin', 'coach')
      )
  and (ath.guardian_email is not null or ath.guardian_user_id is not null);

-- ── 3. Clear them ────────────────────────────────────────────────────────────
update athletes
set guardian_name    = null,
    guardian_email   = null,
    guardian_phone   = null,
    guardian_user_id = null,
    updated_at       = now()
where account_id in (
        select m.account_id
        from memberships m
        join profiles p on p.id = m.user_id
        where p.email = 'maaz.khan@ccript.com'
          and m.role in ('owner', 'admin', 'coach')
      )
  and (guardian_email is not null or guardian_user_id is not null);

-- ── 4. Optional — guardians who also hold a seat in the org ──────────────────
-- Only needed if the Members tab still shows guardians after step 3; those come
-- from real membership rows rather than athlete columns. Review the select
-- before running the delete.
--
-- select m.id, p.email, m.role
-- from memberships m
-- join profiles p on p.id = m.user_id
-- where m.role = 'guardian'
--   and m.account_id in (
--         select m2.account_id
--         from memberships m2
--         join profiles p2 on p2.id = m2.user_id
--         where p2.email = 'maaz.khan@ccript.com'
--           and m2.role in ('owner', 'admin', 'coach')
--       );
--
-- delete from memberships m
-- using profiles p
-- where p.id = m.user_id
--   and m.role = 'guardian'
--   and m.account_id in ( ...same subquery as above... );
