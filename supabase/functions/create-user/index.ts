// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, password, display_name, account_type } = await req.json();

    if (!email || !password) {
      throw new Error('Missing required fields (email, password)');
    }

    // Default to 'guardian' since this function is primarily used for guardian account creation
    const effectiveAccountType = account_type || 'guardian';

    // 1. Check if user already exists using the SQL helper
    const { data: existingUserId } = await supabaseAdmin.rpc('get_user_id_by_email', {
      lookup_email: email,
    });

    if (existingUserId) {
      // User exists — check existing metadata to preserve their staff role if present.
      // get_user_id_by_email matched a row directly in auth.users, but that row can still
      // be unreadable (a known failure mode when an account was deleted through a path
      // that didn't clean up every related table) — getUserById then fails with
      // "Database error loading user". Previously that error was unchecked and threw,
      // silently breaking the "unlink and re-invite" repair flow with the exact same
      // error it was meant to fix. Fall back to the create-new-user path instead.
      const { data: userData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(existingUserId);

      if (!getUserError && userData?.user) {
        const existingMeta = userData.user.user_metadata || {};

        // Any existing non-guardian account_type (admin/coach/assessor/owner) wins: linking
        // an existing staff user as a guardian must never downgrade their access.
        const existingType = existingMeta.account_type;
        const finalAccountType = existingType && existingType !== 'guardian'
          ? existingType
          : effectiveAccountType;

        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          existingUserId,
          {
            password,
            email_confirm: true,
            user_metadata: {
              ...existingMeta,
              display_name: display_name || existingMeta.display_name || 'User',
              account_type: finalAccountType,
            },
          }
        );

        if (updateError) {
          throw updateError;
        }

        return new Response(
          JSON.stringify({ id: existingUserId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }

      console.warn(`getUserById failed for existing id ${existingUserId}, falling back to createUser:`, getUserError?.message);
    }

    // 2. User doesn't exist (or their existing record was unreadable) — create them
    // using the official admin API.
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: display_name || 'User', account_type: effectiveAccountType },
    });

    if (createError) {
      // If get_user_id_by_email's match really was corrupted rather than merely stale,
      // the email is still held by that unreadable auth.users row, and createUser will
      // collide on the unique email constraint — surface that plainly instead of the
      // raw Supabase wording, since re-clicking Resend Invite can't fix this case.
      if (createError.message?.toLowerCase().includes('already been registered') || createError.message?.toLowerCase().includes('already exists')) {
        throw new Error('This email is tied to a corrupted account that could not be repaired automatically. Please contact support to remove the old account before re-inviting.');
      }
      throw createError;
    }

    return new Response(
      JSON.stringify({ id: newUser.user.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('create-user error:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
