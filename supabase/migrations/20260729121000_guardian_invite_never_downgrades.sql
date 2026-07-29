-- ============================================================================
-- Guardian links must never downgrade an existing membership
-- ----------------------------------------------------------------------------
-- invite_org_member_by_email upserted with `do update set role = excluded.role`,
-- so linking an existing owner/admin/coach of the org as a guardian rewrote their
-- membership role to 'guardian'. Every account-scoped write then failed RLS
-- (athletes_write et al. require owner/admin/coach), which surfaced as
-- "new row violates row-level security policy for table athletes".
--
-- The upsert now keeps whichever role is more privileged, so a coach can be
-- linked as guardian to any number of athletes and keeps full staff access,
-- gaining the guardian portal on top. Demoting someone stays possible, but only
-- through the explicit update_org_member_role RPC.
-- ============================================================================

-- Lower rank = more privileged.
CREATE OR REPLACE FUNCTION public.membership_role_rank(r public.membership_role)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE r
    WHEN 'owner'    THEN 0
    WHEN 'admin'    THEN 1
    WHEN 'coach'    THEN 2
    WHEN 'assessor' THEN 3
    WHEN 'guardian' THEN 4
    ELSE 99
  END;
$$;

CREATE OR REPLACE FUNCTION public.invite_org_member_by_email(account_uuid uuid, lookup_email text, org_role text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id uuid;
  target_name text;
  new_membership_id uuid;
  effective_role public.membership_role;
  result json;
BEGIN
  -- 1. Look up user by email
  SELECT id, display_name INTO target_user_id, target_name
  FROM public.profiles
  WHERE lower(email) = lower(lookup_email);

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- 2. Upsert the membership, keeping the more privileged role on conflict
  INSERT INTO public.memberships (account_id, user_id, role)
  VALUES (account_uuid, target_user_id, org_role::public.membership_role)
  ON CONFLICT (account_id, user_id) DO UPDATE
    SET role = CASE
      WHEN public.membership_role_rank(excluded.role)
           < public.membership_role_rank(public.memberships.role)
        THEN excluded.role
      ELSE public.memberships.role
    END
  RETURNING id, role INTO new_membership_id, effective_role;

  -- 3. Return the member representation with the role that was actually stored,
  --    so the UI never shows a downgrade that did not happen.
  SELECT json_build_object(
    'id', new_membership_id,
    'userId', target_user_id,
    'role', effective_role,
    'email', lookup_email,
    'name', target_name,
    'status', 'active'
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_org_member_by_email(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- Repair accounts already orphaned by the old upsert: an individual account with
-- no owner/admin/coach left, but exactly one guardian member, is an account whose
-- owner was overwritten. Restore that member to owner.
-- ----------------------------------------------------------------------------
UPDATE public.memberships m
SET role = 'owner'
WHERE m.role = 'guardian'
  AND EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = m.account_id AND a.type = 'individual'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.memberships staff
    WHERE staff.account_id = m.account_id
      AND staff.role IN ('owner', 'admin', 'coach')
  )
  AND (
    SELECT count(*) FROM public.memberships g
    WHERE g.account_id = m.account_id AND g.role = 'guardian'
  ) = 1;
