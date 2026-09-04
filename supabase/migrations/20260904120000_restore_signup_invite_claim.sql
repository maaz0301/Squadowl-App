-- ============================================================================
-- Restore invite-claiming on signup (assessors + guardians)
-- ----------------------------------------------------------------------------
-- 0002_assessor_linking.sql gave handle_new_user two jobs beyond the profile
-- bootstrap: claim any tryout_assessors row addressed to the new user's email,
-- and claim any athlete whose guardian_email matches. Those two UPDATEs were
-- lost at 0011_user_account_types.sql, which rewrote the function with
-- CREATE OR REPLACE (replacing the whole body, not merging) to add account_type
-- handling, and never came back — 0016 and 20260818145000 both built on the
-- truncated version.
--
-- So invite-before-signup has been silently dead since 0011. The row is created
-- with user_id null and nothing ever fills it in, and every read path keys off
-- exactly that column: tryouts_read -> can_access_tryout matches on
-- tryout_assessors.user_id = auth.uid(), and listAssignedTryouts filters
-- .eq('user_id', userId). An invited assessor could receive the email, sign up
-- with the right address, and land on an empty dashboard.
--
-- Invite-AFTER-signup kept working the whole time — that path goes through the
-- separate trg_link_assessor BEFORE INSERT trigger, which was never touched.
-- Hence the "assessors must create an account before they can be invited" rule
-- the apps had grown: it was a workaround for this bug.
--
-- Below: the current (20260818145000) function body with both claims put back,
-- then an assessor backfill for everyone who signed up while it was broken.
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

  -- 5. Claim assessor invites addressed to this email (restored from 0002).
  --    Deliberately does NOT touch `status`: linking is automatic, accepting is
  --    a decision the assessor still has to make on their dashboard, and
  --    20260812210000_assessor_status_backfill_fix.sql exists precisely to keep
  --    those two things apart.
  UPDATE public.tryout_assessors
     SET user_id = new.id, joined_at = now()
   WHERE user_id IS NULL
     AND email IS NOT NULL
     AND lower(email) = lower(new.email);

  -- 6. Claim guardian links addressed to this email (restored from 0002).
  UPDATE public.athletes
     SET guardian_user_id = new.id
   WHERE guardian_user_id IS NULL
     AND guardian_email IS NOT NULL
     AND lower(guardian_email) = lower(new.email);

  RETURN new;
END;
$$;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Everyone who signed up against a waiting invite between 0011 and now. The
-- scalar subquery (rather than UPDATE ... FROM) keeps the choice deterministic
-- if two profiles ever share an address.

UPDATE public.tryout_assessors ta
   SET user_id = (
         SELECT p.id FROM public.profiles p
          WHERE lower(p.email) = lower(ta.email)
          ORDER BY p.created_at
          LIMIT 1
       ),
       joined_at = coalesce(ta.joined_at, now())
 WHERE ta.user_id IS NULL
   AND ta.email IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM public.profiles p WHERE lower(p.email) = lower(ta.email)
       );

-- The matching guardian backfill is deliberately NOT run here. Linking an
-- athlete to a profile by email match grants that person portal access to the
-- athlete, and doing it in bulk over historical rows would sweep up any record
-- where a staff address ended up in guardian_email (test data, a coach listed
-- as their own child's contact). New signups are covered by step 6 above;
-- existing rows should be linked deliberately, after looking at what matches.
-- The statement to review them, when someone wants to:
--
--   select a.id, a.first_name, a.last_name, a.guardian_email, p.id as profile_id
--     from public.athletes a
--     join public.profiles p on lower(p.email) = lower(a.guardian_email)
--    where a.guardian_user_id is null and a.guardian_email is not null;
