-- ============================================================================
-- Fix NULL auth.users token columns breaking the Admin API
-- ----------------------------------------------------------------------------
-- create_user_with_password inserts into auth.users directly (bypassing
-- GoTrue, which always sets these to '') but only ever set confirmation_token.
-- recovery_token, email_change_token_new, email_change, phone_change,
-- phone_change_token, email_change_token_current and reauthentication_token
-- were left at their column default of NULL.
--
-- GoTrue's Go structs scan these into non-nullable strings, so any Admin API
-- call that has to load the full user row (getUserById, updateUserById,
-- createUser's own duplicate-email check) fails on a NULL with a generic
-- "Database error loading user" / "Database error checking email" — even
-- though the row is otherwise completely valid and plain SQL against it (e.g.
-- get_user_id_by_email) works fine. This is what broke Resend Invite: 100 of
-- 153 existing auth.users rows had this defect.
-- ============================================================================

-- 1. Repair every row already affected.
UPDATE auth.users
SET recovery_token = COALESCE(recovery_token, ''),
    confirmation_token = COALESCE(confirmation_token, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''),
    email_change = COALESCE(email_change, ''),
    phone_change = COALESCE(phone_change, ''),
    phone_change_token = COALESCE(phone_change_token, ''),
    reauthentication_token = COALESCE(reauthentication_token, '')
WHERE recovery_token IS NULL
   OR confirmation_token IS NULL
   OR email_change_token_current IS NULL
   OR email_change_token_new IS NULL
   OR email_change IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL;

-- 2. Drop the old 3-arg overload from 0008_auto_create_users_rpc.sql — it has
-- the same missing-token bug and is superseded by the 4-arg version below,
-- but Postgres overloading means it was still callable and still broken.
DROP FUNCTION IF EXISTS public.create_user_with_password(text, text, text);

-- 3. Fix the function so it stops creating broken rows going forward.
CREATE OR REPLACE FUNCTION public.create_user_with_password(
  email text,
  password text,
  display_name text,
  account_type text DEFAULT 'guardian'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  existing_user_id uuid;
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

  -- Check if user already exists
  SELECT id INTO existing_user_id FROM auth.users WHERE auth.users.email = create_user_with_password.email;

  IF existing_user_id IS NOT NULL THEN
    -- Update the password and metadata for the existing user (preserve staff account_type),
    -- and repair any NULL token columns left by an older version of this function.
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(password, extensions.gen_salt('bf')),
        raw_user_meta_data = CASE
          WHEN COALESCE(raw_user_meta_data->>'account_type', '') NOT IN ('', 'guardian') THEN
            raw_user_meta_data || jsonb_build_object('display_name', COALESCE(display_name, raw_user_meta_data->>'display_name'))
          ELSE
            raw_user_meta_data || jsonb_build_object('display_name', display_name, 'account_type', account_type)
        END,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        recovery_token = COALESCE(recovery_token, ''),
        confirmation_token = COALESCE(confirmation_token, ''),
        email_change_token_current = COALESCE(email_change_token_current, ''),
        email_change_token_new = COALESCE(email_change_token_new, ''),
        email_change = COALESCE(email_change, ''),
        phone_change = COALESCE(phone_change, ''),
        phone_change_token = COALESCE(phone_change_token, ''),
        reauthentication_token = COALESCE(reauthentication_token, ''),
        updated_at = now()
    WHERE id = existing_user_id;

    -- Ensure an auth.identities record exists for the user to allow password login
    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      existing_user_id,
      existing_user_id::text,
      jsonb_build_object('sub', existing_user_id::text, 'email', email),
      'email',
      now(),
      now(),
      now()
    ) ON CONFLICT DO NOTHING;

    RETURN json_build_object('id', existing_user_id);
  END IF;

  -- Generate a new user ID
  new_user_id := gen_random_uuid();

  -- Insert into auth.users securely (auto-confirmed) with account_type in metadata.
  -- Every token column GoTrue's Admin API scans into a non-nullable string is set
  -- to '' explicitly here — leaving any of them at their NULL default is what
  -- broke Resend Invite / getUserById / createUser for every account this
  -- function created.
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_current,
    email_change_token_new, email_change, phone_change, phone_change_token,
    reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    email,
    extensions.crypt(password, extensions.gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    jsonb_build_object('display_name', display_name, 'account_type', account_type),
    now(),
    now(),
    '', '', '', '', '', '', '', ''
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

REVOKE EXECUTE ON FUNCTION public.create_user_with_password(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_user_with_password(text, text, text, text) TO authenticated;
