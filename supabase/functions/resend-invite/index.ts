// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { userId, email, role } = await req.json();

    if (!userId || !email) {
      throw new Error('Missing required fields (userId, email)');
    }

    // 1. An account that has already signed in keeps its password. Resetting
    //    it would lock a real person out of their own login and mail them a
    //    password they never asked for. Only an account that was created by
    //    the invite and never used gets a fresh temporary password.
    const { data: existing, error: lookupError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (lookupError) {
      throw lookupError;
    }
    const alreadyUsed = !!existing?.user?.last_sign_in_at;

    let newPassword: string | undefined;
    if (!alreadyUsed) {
      // 2. Generate a new secure temporary password and set it.
      newPassword = Math.random().toString(36).slice(-6) + 'Aa1!';
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { password: newPassword }
      );

      if (updateError) {
        throw updateError;
      }
    }

    // 3. Invoke the send-email Edge Function internally to send the email
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        type: 'org_invite',
        to: email,
        payload: {
          role: role ?? 'guardian',
          password: newPassword,
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to dispatch email: ${errorText}`);
    }

    return new Response(JSON.stringify({ success: true, passwordReset: !alreadyUsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Edge Function Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
