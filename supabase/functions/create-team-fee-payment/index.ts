// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SquadOwl's cut of every fee collected through Connect — kept in sync with
// create-registration-payment/index.ts and stripe-connect-webhook/index.ts.
const PLATFORM_FEE_RATE = 0.005;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) {
      throw new Error('No authorization header');
    }
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userError || !user) {
      throw new Error('User not found');
    }

    const { seasonRosterId, successUrl, cancelUrl } = await req.json();
    if (!seasonRosterId) {
      throw new Error('seasonRosterId is required');
    }

    const { data: rosterRow, error: rosterError } = await supabaseAdmin
      .from('season_roster')
      .select(
        'id, fee_status, stripe_checkout_session_id, athletes(guardian_user_id, guardian_email), ' +
          'seasons(id, account_id, team_id, teams(id, collects_fees, registration_fee_cents), ' +
          'accounts(id, plan_tier, stripe_connect_account_id, stripe_connect_charges_enabled))',
      )
      .eq('id', seasonRosterId)
      .single();

    if (rosterError || !rosterRow) {
      throw new Error('Roster entry not found');
    }

    // @ts-ignore: Supabase's typed client doesn't know the nested join shape here
    const athlete = Array.isArray(rosterRow.athletes) ? rosterRow.athletes[0] : rosterRow.athletes;
    // @ts-ignore
    const season = Array.isArray(rosterRow.seasons) ? rosterRow.seasons[0] : rosterRow.seasons;
    const team = Array.isArray(season?.teams) ? season.teams[0] : season?.teams;
    const account = Array.isArray(season?.accounts) ? season.accounts[0] : season?.accounts;

    // Only this athlete's guardian may pay their fee — mirrors the uid-or-email
    // match getGuardianRosters uses client-side, since guardian_user_id doesn't
    // always get backfilled at signup time.
    const isGuardian =
      athlete?.guardian_user_id === user.id ||
      (!!athlete?.guardian_email && athlete.guardian_email.toLowerCase() === (user.email ?? '').toLowerCase());
    if (!isGuardian) {
      throw new Error('Not authorized to pay this fee');
    }

    if (rosterRow.fee_status === 'paid') {
      throw new Error('This fee has already been paid.');
    }

    const feeCents: number | null = team?.registration_fee_cents ?? null;
    const connectAccountId: string | null = account?.stripe_connect_account_id ?? null;
    const chargesEnabled: boolean = account?.stripe_connect_charges_enabled ?? false;
    const planTier: string = account?.plan_tier ?? 'free';

    if (!team?.collects_fees || !feeCents || feeCents <= 0) {
      throw new Error('This team does not have a fee to collect.');
    }
    // Fee collection is a paid-plan feature (see limits.payments in src/data/plans.ts).
    // A team can be left with collects_fees/registration_fee_cents set from before a
    // downgrade, so this has to be re-checked here rather than trusted from the client.
    if (planTier === 'free') {
      throw new Error('Collecting fees requires the coach to be on a Coach plan or higher.');
    }
    if (!connectAccountId || !chargesEnabled) {
      throw new Error("This coach hasn't finished setting up payments yet.");
    }

    // Reuse an existing open Checkout Session instead of stacking duplicate charges
    // if a guardian re-submits the pay step (e.g. navigated back and retried).
    if (rosterRow.stripe_checkout_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          rosterRow.stripe_checkout_session_id,
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
              product_data: { name: 'Team Fee' },
              unit_amount: feeCents,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: applicationFeeAmount,
        },
        // Pre-fills Stripe's checkout page so the guardian doesn't have to
        // retype it — prefer their actual account email over the athlete's
        // (possibly stale) guardian_email on file.
        customer_email: user.email ?? athlete?.guardian_email ?? undefined,
        success_url: successUrl || 'aastryout://guardian?feePaid=true',
        cancel_url: cancelUrl || 'aastryout://guardian?feePaid=false',
        metadata: {
          seasonRosterId,
          accountId: account.id,
        },
      },
      { stripeAccount: connectAccountId },
    );

    await supabaseAdmin
      .from('season_roster')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', seasonRosterId);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    console.error('Error in create-team-fee-payment:', err.message || err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
