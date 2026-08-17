-- ============================================================================
-- Migration 0009: Strengthen RLS and Guardians
-- ============================================================================

-- 1. Strengthen RLS on evaluations to prevent assessors from overwriting each other
DROP POLICY IF EXISTS evaluations_write ON public.evaluations;

CREATE POLICY evaluations_write ON public.evaluations
  FOR ALL USING (
    evaluator_user_id = auth.uid() OR public.can_manage_tryout(tryout_id)
  )
  WITH CHECK (
    evaluator_user_id = auth.uid() OR public.can_manage_tryout(tryout_id)
  );

DROP POLICY IF EXISTS eval_scores_rw ON public.evaluation_scores;

CREATE POLICY eval_scores_rw ON public.evaluation_scores
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.evaluations e 
      WHERE e.id = evaluation_id 
      AND (e.evaluator_user_id = auth.uid() OR public.can_manage_tryout(e.tryout_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.evaluations e 
      WHERE e.id = evaluation_id 
      AND (e.evaluator_user_id = auth.uid() OR public.can_manage_tryout(e.tryout_id))
    )
  );

-- 2. Secure the user auto-creation RPC from arbitrary authenticated users
CREATE OR REPLACE FUNCTION public.create_user_with_password(
  email text,
  password text,
  display_name text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  new_user_id uuid;
BEGIN
  -- Verify caller is logged in
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Prevent arbitrary users from creating accounts; must be a coach/admin/owner of some account
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships 
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'coach')
  ) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized to create user accounts';
  END IF;

  -- Generate a new user ID
  new_user_id := gen_random_uuid();
  
  -- Insert into auth.users securely (auto-confirmed)
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    email,
    extensions.crypt(password, extensions.gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    jsonb_build_object('display_name', display_name),
    now(),
    now(),
    ''
  );
  
  -- Insert the identity so they can log in with email
  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    new_user_id,
    new_user_id::text,
    jsonb_build_object('sub', new_user_id::text, 'email', email),
    'email',
    now(),
    now()
  );

  RETURN json_build_object('id', new_user_id);
END;
$$;
