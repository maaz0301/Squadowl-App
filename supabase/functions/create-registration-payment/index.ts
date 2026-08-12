// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// TryoutHQ's cut of every registration fee collected through Connect.
const PLATFORM_FEE_RATE = 0.005;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { registrationId, successUrl, cancelUrl } = await req.json();
    if (!registrationId) {
      throw new Error('registrationId is required');
    }

    const { data: registration, error: regError } = await supabaseAdmin
      .from('registrations')
      .select('id, guardian_email, stripe_checkout_session_id, tryouts(id, registration_fee_cents, accounts(id, plan_tier, stripe_connect_account_id, stripe_connect_charges_enabled))')
      .eq('id', registrationId)
      .single();

    if (regError || !registration) {
      throw new Error('Registration not found');
    }

    // @ts-ignore: Supabase's typed client doesn't know the nested join shape here
    const tryout = Array.isArray(registration.tryouts) ? registration.tryouts[0] : registration.tryouts;
    const account = Array.isArray(tryout?.accounts) ? tryout.accounts[0] : tryout?.accounts;

    const feeCents: number | null = tryout?.registration_fee_cents ?? null;
    const connectAccountId: string | null = account?.stripe_connect_account_id ?? null;
    const chargesEnabled: boolean = account?.stripe_connect_charges_enabled ?? false;
    const planTier: string = account?.plan_tier ?? 'free';

    if (!feeCents || feeCents <= 0) {
      throw new Error('This event does not have a registration fee.');
    }
    // Fee collection is a paid-plan feature (see limits.payments in src/data/plans.ts).
    // A team can be left with collectsFees/registrationFeeCents set from before a
    // downgrade, so this has to be re-checked here rather than trusted from the client.
    if (planTier === 'free') {
      throw new Error('Collecting registration fees requires a Coach plan or higher.');
    }
    if (!connectAccountId || !chargesEnabled) {
      throw new Error('This coach has not finished setting up payments yet.');
    }

    // Reuse an existing open Checkout Session instead of stacking duplicate charges
    // if a guardian re-submits the pay step (e.g. navigated back and retried).
    if (registration.stripe_checkout_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          registration.stripe_checkout_session_id,
          { stripeAccount: connectAccountId },
        );
        if (existing.status === 'open' && existing.url) {
          return new Response(JSON.stringify({ url: existing.url }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          });
        }
      } catch {
        // Session expired/invalid — fall through and create a new one.
      }
    }

    const applicationFeeAmount = Math.round(feeCents * PLATFORM_FEE_RATE);

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'cad',
              product_data: { name: 'Registration Fee' },
              unit_amount: feeCents,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: applicationFeeAmount,
        },
        // Pre-fills Stripe's checkout page with the guardian's email from
        // the registration form so they don't have to retype it.
        customer_email: registration.guardian_email ?? undefined,
        success_url: successUrl || 'aastryout://register?paid=true',
        cancel_url: cancelUrl || 'aastryout://register?paid=false',
        metadata: {
          registrationId,
          tryoutId: tryout.id,
          accountId: account.id,
        },
      },
      { stripeAccount: connectAccountId },
    );

    await supabaseAdmin
      .from('registrations')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', registrationId);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    console.error('Error in create-registration-payment:', err.message || err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
