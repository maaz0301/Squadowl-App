-- Enable pgcrypto for password hashing if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.create_user_with_password(
  email text,
  password text,
  display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id uuid;
BEGIN
  -- Verify caller is logged in and authorized
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
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
    crypt(password, gen_salt('bf')),
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

  RETURN new_user_id;
END;
$$;

-- Only let authenticated users execute this
REVOKE EXECUTE ON FUNCTION public.create_user_with_password(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_user_with_password(text, text, text) TO authenticated;
