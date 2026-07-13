-- Helper function to look up a user ID by email (used by Edge Functions)
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(lookup_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_id uuid;
BEGIN
  SELECT id INTO found_id FROM auth.users WHERE email = lookup_email LIMIT 1;
  RETURN found_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;
