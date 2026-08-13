import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { resolvePrimaryMembership } from '../_shared/membership.ts';

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

    // Must match the membership the app reads the enabled flag off — see
    // resolvePrimaryMembership.
    const membership = await resolvePrimaryMembership(
      user.id,
      'id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled',
    );
    const connectAccountId: string | null = membership.account?.stripe_connect_account_id ?? null;

    if (!connectAccountId) {
      return new Response(JSON.stringify({ connected: false, platformFeeRate: PLATFORM_FEE_RATE }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const liveAccount = await stripe.accounts.retrieve(connectAccountId);

    // Write the live values back, so the cached flag on the account row heals
    // itself every time this screen opens. Without this the column only ever
    // moves when the account.updated webhook fires — and that webhook needs a
    // Connect-specific endpoint and signing secret that Stripe fails *silently*
    // when misconfigured, stranding a fully-onboarded coach on "Connect with
    // Stripe" indefinitely.
    if (
      !!membership.account?.stripe_connect_charges_enabled !== !!liveAccount.charges_enabled ||
      !!membership.account?.stripe_connect_payouts_enabled !== !!liveAccount.payouts_enabled
    ) {
      const { error: syncError } = await supabaseAdmin
        .from('accounts')
        .update({
          stripe_connect_charges_enabled: !!liveAccount.charges_enabled,
          stripe_connect_payouts_enabled: !!liveAccount.payouts_enabled,
        })
        .eq('id', membership.accountId);
      if (syncError) {
        console.error('Failed to sync connect flags from live account:', syncError.message);
      }
    }

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
