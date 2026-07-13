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
      // User exists — update their password using the official admin API
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        existingUserId,
        {
          password,
          email_confirm: true,
          user_metadata: { display_name: display_name, account_type: effectiveAccountType },
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

    // 2. User doesn't exist — create them using the official admin API
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: display_name || 'User', account_type: effectiveAccountType },
    });

    if (createError) {
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
