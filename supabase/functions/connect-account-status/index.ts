import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// TryoutHQ's cut of every registration fee collected through Connect — kept in
// sync with create-registration-payment/index.ts and stripe-connect-webhook/index.ts.
const PLATFORM_FEE_RATE = 0.005;

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
      .select('accounts(stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (membershipError || !membership) {
      throw new Error('No account membership found for user');
    }

    // @ts-ignore
    const account = Array.isArray(membership.accounts) ? membership.accounts[0] : membership.accounts;
    const connectAccountId: string | null = account?.stripe_connect_account_id ?? null;

    if (!connectAccountId) {
      return new Response(JSON.stringify({ connected: false, platformFeeRate: PLATFORM_FEE_RATE }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const liveAccount = await stripe.accounts.retrieve(connectAccountId);

    return new Response(
      JSON.stringify({
        connected: true,
        accountId: liveAccount.id,
        email: liveAccount.email ?? null,
        businessName: liveAccount.business_profile?.name ?? liveAccount.company?.name ?? null,
        country: liveAccount.country ?? null,
        defaultCurrency: liveAccount.default_currency ?? null,
        chargesEnabled: !!liveAccount.charges_enabled,
        payoutsEnabled: !!liveAccount.payouts_enabled,
        platformFeeRate: PLATFORM_FEE_RATE,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err: any) {
    console.error('Error in connect-account-status:', err.message || err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
