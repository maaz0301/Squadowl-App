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
    const { planTier } = await req.json();

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
      .select('account_id, accounts(id, stripe_customer_id, type)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (membershipError || !membership) {
      throw new Error('No account membership found for user');
    }

    const accountId = membership.account_id;
    // @ts-ignore
    let customerId = Array.isArray(membership.accounts) ? membership.accounts[0]?.stripe_customer_id : membership.accounts?.stripe_customer_id;

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

    // Price mapping for CAD currency fallback
    const TIER_PRICES_CAD: Record<string, { name: string; amount: number }> = {
      coach: { name: 'Coach Plan', amount: 2999 },
      club: { name: 'Club Plan', amount: 5999 },
      pro: { name: 'Pro Plan', amount: 9999 },
      association: { name: 'Association Plan', amount: 24999 },
      enterprise: { name: 'Enterprise Plan', amount: 24999 },
    };

    const rawPriceId = Deno.env.get(`STRIPE_PRICE_ID_${planTier.toUpperCase()}`);
    const priceId = rawPriceId && rawPriceId.trim() !== '' && rawPriceId !== 'undefined' && rawPriceId !== 'null' ? rawPriceId.trim() : null;

    let lineItem: any;
    if (priceId) {
      lineItem = { price: priceId, quantity: 1 };
    } else {
      const tierInfo = TIER_PRICES_CAD[planTier.toLowerCase()];
      if (!tierInfo) {
        throw new Error(`Invalid plan tier: ${planTier}`);
      }
      lineItem = {
        price_data: {
          currency: 'cad',
          product_data: {
            name: `TryoutHQ ${tierInfo.name}`,
          },
          unit_amount: tierInfo.amount,
          recurring: {
            interval: 'year',
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
      success_url: `aastryout://upgrade?success=true`,
      cancel_url: `aastryout://upgrade?canceled=true`,
      metadata: {
        accountId: accountId,
        planTier: planTier,
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
