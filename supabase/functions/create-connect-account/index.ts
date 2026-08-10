import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('memberships')
      .select('account_id, accounts(id, stripe_connect_account_id)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (membershipError || !membership) {
      throw new Error('No account membership found for user');
    }

    const accountId = membership.account_id;
    // @ts-ignore
    let connectAccountId = Array.isArray(membership.accounts)
      ? membership.accounts[0]?.stripe_connect_account_id
      : membership.accounts?.stripe_connect_account_id;

    if (!connectAccountId) {
      const connectAccount = await stripe.accounts.create({
        type: 'standard',
        country: 'CA',
        email: user.email,
        metadata: { accountId },
      });
      connectAccountId = connectAccount.id;

      await supabaseAdmin
        .from('accounts')
        .update({ stripe_connect_account_id: connectAccountId })
        .eq('id', accountId);
    }

    const accountLink = await stripe.accountLinks.create({
      account: connectAccountId,
      refresh_url: `aastryout://payments?connect_refresh=true`,
      return_url: `aastryout://payments?connect_return=true`,
      type: 'account_onboarding',
    });

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    console.error('Error in create-connect-account:', err.message || err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
