-- Enable pgcrypto for password hashing if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP FUNCTION IF EXISTS public.create_user_with_password(text, text, text);

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
  existing_user_id uuid;
  new_user_id uuid;
BEGIN
  -- Verify caller is logged in and authorized
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Check if user already exists
  SELECT id INTO existing_user_id FROM auth.users WHERE auth.users.email = create_user_with_password.email;

  IF existing_user_id IS NOT NULL THEN
    -- Update the password for the existing user
    UPDATE auth.users 
    SET encrypted_password = extensions.crypt(password, extensions.gen_salt('bf', 10)),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
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
      now()
    ) ON CONFLICT DO NOTHING;

    RETURN json_build_object('id', existing_user_id);
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
    extensions.crypt(password, extensions.gen_salt('bf', 10)),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    jsonb_build_object('display_name', display_name),
    now(),
    now(),
    ''
  );
  
  -- Insert into auth.identities to ensure the user can actually log in
  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
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

-- Only let authenticated users execute this
REVOKE EXECUTE ON FUNCTION public.create_user_with_password(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_user_with_password(text, text, text) TO authenticated;
