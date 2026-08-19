-- ============================================================================
-- Ensure handle_new_user never fails on orphan profiles or duplicate emails
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_account_id uuid;
  user_account_type text;
BEGIN
  -- 1. If an orphaned profile exists with the same email but a different ID, clean it up
  DELETE FROM public.profiles 
  WHERE lower(email) = lower(new.email) AND id <> new.id;

  -- 2. Insert or update the profile for the new user
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE SET
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name);

  -- 3. Extract account type from metadata, default to 'coach' if not specified
  user_account_type := coalesce(new.raw_user_meta_data->>'account_type', 'coach');

  -- 4. If coach, create their organization account if they don't already own one
  IF user_account_type = 'coach' AND NOT EXISTS (
    SELECT 1 FROM public.memberships WHERE user_id = new.id AND role = 'owner'
  ) THEN
    INSERT INTO public.accounts (type, name, plan_tier)
    VALUES (
      'individual',
      coalesce(new.raw_user_meta_data->>'display_name', 'My Account'),
      'free'
    )
    RETURNING id INTO new_account_id;

    INSERT INTO public.memberships (account_id, user_id, role)
    VALUES (new_account_id, new.id, 'owner');
  END IF;

  RETURN new;
END;
$$;
