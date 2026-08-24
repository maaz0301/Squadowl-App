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
    const { planTier, interval: rawInterval, addOn, quantity: rawQuantity, origin } = await req.json();
    const interval: 'year' | 'month' = rawInterval === 'month' ? 'month' : 'year';
    const webOrigin = resolveWebOrigin(origin);
    // Add-on team licenses (Club: CAD$10/team/year beyond the 6 included) go through
    // the same checkout, but they must not touch plan_tier — see the metadata below.
    const isTeamLicense = addOn === 'team_licenses';
    const licenseQuantity = Math.max(1, Math.min(100, Math.round(Number(rawQuantity) || 1)));

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
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('memberships')
      .select('account_id, accounts(id, stripe_customer_id, type, plan_tier)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (membershipError || !membership) {
      throw new Error('No account membership found for user');
    }

    const accountId = membership.account_id;
    // @ts-ignore
    const account = Array.isArray(membership.accounts) ? membership.accounts[0] : membership.accounts;
    let customerId = account?.stripe_customer_id;

    // Extra teams are a Club-only add-on. Selling them to a lower tier would hand out
    // teams the plan's cap ignores anyway (getTeamAllowance only counts licenses on
    // tiers with extraTeamPriceCents), i.e. the customer would pay for nothing.
    if (isTeamLicense && account?.plan_tier !== 'club') {
      throw new Error('Additional teams are only available on the Club plan. Upgrade to Club first.');
    }

    if (!customerId) {
      // Create a stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          accountId: accountId,
        },
      });
      customerId = customer.id;
      
      await supabaseAdmin
        .from('accounts')
        .update({ stripe_customer_id: customerId })
        .eq('id', accountId);
    }

    // Price mapping for CAD currency fallback, used when no Stripe Dashboard price ID
    // is configured for this tier/interval via env var (see below).
    const TIER_PRICES_CAD: Record<string, { name: string; year: number; month: number }> = {
      coach: { name: 'Coach Plan', year: 3999, month: 400 },
      coach_plus: { name: 'Coach+ Plan', year: 6999, month: 700 },
      club: { name: 'Club Plan', year: 9999, month: 1000 },
    };

    /** CAD$10/team/year — mirrors EXTRA_TEAM_PRICE_CENTS in src/data/plans.ts. */
    const EXTRA_TEAM_PRICE_CENTS = 1000;

    const envKey = isTeamLicense
      ? 'STRIPE_PRICE_ID_TEAM_LICENSE_YEARLY'
      : `STRIPE_PRICE_ID_${String(planTier ?? '').toUpperCase()}_${interval === 'year' ? 'YEARLY' : 'MONTHLY'}`;
    const rawPriceId = Deno.env.get(envKey);
    const priceId = rawPriceId && rawPriceId.trim() !== '' && rawPriceId !== 'undefined' && rawPriceId !== 'null' ? rawPriceId.trim() : null;

    let lineItem: any;
    if (isTeamLicense) {
      lineItem = priceId
        ? { price: priceId, quantity: licenseQuantity }
        : {
            price_data: {
              currency: 'cad',
              product_data: { name: 'TryoutHQ Additional Team' },
              unit_amount: EXTRA_TEAM_PRICE_CENTS,
              recurring: { interval: 'year' },
            },
            quantity: licenseQuantity,
          };
    } else if (priceId) {
      lineItem = { price: priceId, quantity: 1 };
    } else {
      const tierInfo = TIER_PRICES_CAD[String(planTier ?? '').toLowerCase()];
      if (!tierInfo) {
        throw new Error(`Invalid plan tier: ${planTier}`);
      }
      lineItem = {
        price_data: {
          currency: 'cad',
          product_data: {
            name: `TryoutHQ ${tierInfo.name}`,
          },
          unit_amount: tierInfo[interval],
          recurring: {
            interval,
          },
        },
        quantity: 1,
      };
    }

    let session;
    const createSessionParams = {
      customer: customerId,
      line_items: [lineItem],
      mode: 'subscription' as const,
      success_url: webOrigin ? `${webOrigin}/upgrade?success=true` : `aastryout://upgrade?success=true`,
      cancel_url: webOrigin ? `${webOrigin}/upgrade?canceled=true` : `aastryout://upgrade?canceled=true`,
      // A team-license purchase deliberately carries no planTier: the webhook keys off
      // `type` and only increments extra_team_licenses, leaving the plan alone.
      metadata: isTeamLicense
        ? {
            accountId: accountId,
            type: 'team_license',
            quantity: String(licenseQuantity),
            interval: 'year',
          }
        : {
            accountId: accountId,
            planTier: planTier,
            interval: interval,
          },
    };

    try {
      session = await stripe.checkout.sessions.create(createSessionParams);
    } catch (checkoutErr: any) {
      if (checkoutErr.message && checkoutErr.message.includes('cannot combine currencies')) {
        // Customer has legacy currency (e.g. USD) attached. Create a new Stripe Customer for CAD.
        const newCustomer = await stripe.customers.create({
          email: user.email,
          metadata: { accountId: accountId },
        });
        customerId = newCustomer.id;
        await supabaseAdmin
          .from('accounts')
          .update({ stripe_customer_id: customerId })
          .eq('id', accountId);

        session = await stripe.checkout.sessions.create({
          ...createSessionParams,
          customer: customerId,
        });
      } else {
        throw checkoutErr;
      }
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    console.error('Error in create-checkout-session:', err.message || err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
