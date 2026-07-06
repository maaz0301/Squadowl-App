-- Update handle_new_user to respect account_type metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_account_id uuid;
  user_account_type text;
BEGIN
  -- Always create the profile
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );

  -- Extract account type from metadata, default to 'coach' if not specified
  user_account_type := coalesce(new.raw_user_meta_data->>'account_type', 'coach');

  -- If it's a coach, create an organization (account)
  IF user_account_type = 'coach' THEN
    INSERT INTO public.accounts (type, name, plan_tier)
    VALUES (
      'individual',
      coalesce(new.raw_user_meta_data->>'display_name', 'My Account'),
      'free'
    )
    RETURNING id INTO new_account_id;

    -- Make the new user the owner of their account
    INSERT INTO public.memberships (account_id, user_id, role)
    VALUES (new_account_id, new.id, 'owner');
  END IF;
  
  -- If account_type is 'guardian', we do not create an account or membership.
  -- They are purely a guardian profile.

  RETURN new;
END;
$$;
