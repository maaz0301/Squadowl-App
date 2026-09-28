import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { resolveWebOrigin } from '../_shared/webOrigin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * What this checkout's single line item comes to, in cents — needed to size a
 * loyalty-credit coupon against it. Inline `price_data` carries the amount
 * already; a configured Stripe Dashboard price has to be fetched. Returns 0 when
 * the amount can't be determined, which suppresses the discount rather than
 * guessing at one.
 */
async function resolveLineItemTotalCents(lineItem: any): Promise<number> {
  const quantity = Math.max(1, Number(lineItem?.quantity) || 1);
  if (lineItem?.price_data?.unit_amount != null) {
    return Number(lineItem.price_data.unit_amount) * quantity;
  }
  if (lineItem?.price) {
    try {
      const price = await stripe.prices.retrieve(lineItem.price);
      if (price?.unit_amount != null) return Number(price.unit_amount) * quantity;
    } catch (err: any) {
      console.error('Could not retrieve price for credit sizing:', err.message || err);
    }
  }
  return 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { planTier, interval: rawInterval, addOn, quantity: rawQuantity, origin, applyCredits, discountCode: rawDiscountCode } = await req.json();
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

    // Extra teams are a Coach+ and Club add-on. Selling them to a lower tier would hand
    // out teams the plan's cap ignores anyway (getTeamAllowance only counts licenses on
    // tiers with extraTeamPriceCents), i.e. the customer would pay for nothing.
    if (isTeamLicense && account?.plan_tier !== 'club' && account?.plan_tier !== 'coach_plus') {
      throw new Error('Additional teams are only available on the Coach+ and Club plans. Upgrade first.');
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

    // Founder-issued discount code (founder console → Billing → Discount Codes).
    // Validated here against its limits/expiry/plan tiers, then applied as a
    // one-off Stripe coupon. The use is only recorded by stripe-webhook once the
    // checkout completes, so an abandoned checkout doesn't burn one.
    const discountCode = typeof rawDiscountCode === 'string' ? rawDiscountCode.trim() : '';
    let discount: any = null;
    if (discountCode) {
      if (isTeamLicense) {
        throw new Error('Discount codes apply to plan upgrades only.');
      }
      const { data: check, error: checkErr } = await supabaseAdmin.rpc('check_discount_code', {
        p_code: discountCode,
        p_plan_tier: String(planTier ?? '').toLowerCase(),
        p_account_id: accountId,
      });
      if (checkErr) {
        console.error('Error checking discount code:', checkErr);
        throw new Error('Could not check that discount code. Please try again.');
      }
      if (!check?.valid) {
        throw new Error(check?.message || "That discount code isn't valid.");
      }
      discount = check;
    }

    // Loyalty credit. The balance is drawn down as a one-off coupon on this
    // checkout's first invoice; the ledger is only debited once the webhook sees
    // the session complete, so abandoning checkout costs the customer nothing.
    let creditCents = 0;
    let couponId: string | null = null;
    // Checkout takes a single discount, so a discount code wins and the credit
    // stays on the ledger for a later payment.
    if (applyCredits && !discount) {
      const { data: available, error: creditErr } = await supabaseAdmin.rpc(
        'referral_available_credit',
        { p_account_id: accountId },
      );
      if (creditErr) {
        // A failure to read the balance must not block the sale — the customer
        // pays full price and keeps the credit for next time.
        console.error('Error reading referral credit:', creditErr);
      } else {
        // Capped a cent below the line total on purpose. A $60 balance can
        // exceed a $39.99 Coach plan outright, and a fully-discounted first
        // invoice is a different checkout shape (nothing charged today) than the
        // rest of this flow assumes. Leaving one cent keeps it an ordinary paid
        // checkout; the unspent remainder stays on the ledger for next time.
        const subtotalCents = await resolveLineItemTotalCents(lineItem);
        const spendable = subtotalCents > 1 ? subtotalCents - 1 : 0;
        creditCents = Math.max(0, Math.min(Number(available) || 0, spendable));
      }
    }

    if (discount) {
      const coupon = await stripe.coupons.create({
        ...(discount.kind === 'percent'
          ? { percent_off: Number(discount.percentOff) }
          : { amount_off: Number(discount.amountOffCents), currency: 'cad' }),
        duration: discount.duration,
        ...(discount.duration === 'repeating' ? { duration_in_months: Number(discount.durationMonths) } : {}),
        max_redemptions: 1,
        name: `TryoutHQ code ${discount.code}`,
        metadata: { accountId, discountCodeId: discount.id, discountCode: discount.code },
      });
      couponId = coupon.id;
    } else if (creditCents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: creditCents,
        currency: 'cad',
        duration: 'once',
        max_redemptions: 1,
        name: 'TryoutHQ loyalty credit',
        metadata: { accountId },
      });
      couponId = coupon.id;
    }

    let session;
    const createSessionParams = {
      customer: customerId,
      line_items: [lineItem],
      mode: 'subscription' as const,
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
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
            // Tells the webhook how much loyalty credit to debit once this
            // session completes. Absent/'0' means nothing to debit.
            referralCreditsCents: String(creditCents),
          }
        : {
            accountId: accountId,
            planTier: planTier,
            interval: interval,
            referralCreditsCents: String(creditCents),
            // Tells the webhook which discount code to record a use of.
            ...(discount ? { discountCodeId: discount.id, discountCode: discount.code } : {}),
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
