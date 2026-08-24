import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { resolveWebOrigin } from '../_shared/webOrigin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const webOrigin = resolveWebOrigin((await req.json().catch(() => ({})))?.origin);

    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    
    if (userError || !user) {
      throw new Error('User not found');
    }

    // Lookup memberships to find the tenant account
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('account_id, accounts(stripe_customer_id)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    
    let customerId;
    if (membership && membership.accounts) {
      // @ts-ignore
      customerId = Array.isArray(membership.accounts) ? membership.accounts[0]?.stripe_customer_id : membership.accounts?.stripe_customer_id;
    }

    if (!customerId) {
      throw new Error('Could not find active Stripe customer for this user.');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: webOrigin ? `${webOrigin}/profile` : `aastryout://profile`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
