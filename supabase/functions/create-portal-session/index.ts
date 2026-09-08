import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { resolveWebOrigin } from '../_shared/webOrigin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** The three paid tiers' price env vars, same names create-checkout-session and the webhook read. */
const PRICE_ENV_KEYS = [
  'STRIPE_PRICE_ID_COACH_MONTHLY',
  'STRIPE_PRICE_ID_COACH_YEARLY',
  'STRIPE_PRICE_ID_COACH_PLUS_MONTHLY',
  'STRIPE_PRICE_ID_COACH_PLUS_YEARLY',
  'STRIPE_PRICE_ID_CLUB_MONTHLY',
  'STRIPE_PRICE_ID_CLUB_YEARLY',
] as const;

/**
 * Makes sure the account's Stripe Customer Portal actually offers switching
 * between Coach/Coach+/Club, in both directions, before handing back a
 * session URL.
 *
 * upgrade/page.tsx already routes every downgrade (and an upgrade with a live
 * subscription) through this portal — switchPlan()'s confirm dialog explicitly
 * promises "You'll finish the change in Stripe, where the new price and any
 * credit for the rest of this term are shown before you confirm." Without the
 * portal's own `subscription_update` feature turned on and pointed at these
 * three products, none of that is actually available once the customer gets
 * there — Move down to Coach+ opens the portal to a page with no plan-switch
 * option at all, silently short of what the confirm dialog just told them.
 *
 * `create_prorations` matches that promised copy exactly: Stripe shows the
 * prorated difference and lets the customer confirm it, rather than an
 * unreviewed silent charge (`always_invoice`) or no proration at all (`none`).
 *
 * Downgrading to Free has no Stripe price to switch to — it only exists as
 * cancelling the subscription outright, which is why downgradeRoute() sends
 * Free here too. `subscription_cancel` is turned on for that, `at_period_end`
 * so the account keeps what it already paid for through the current term,
 * consistent with every other plan change here settling at term end/renewal.
 *
 * Idempotent and cheap to call on every portal open: one list + at most one
 * update, and the update is skipped once Stripe already reports both features
 * configured with the current price set.
 */
async function ensurePortalConfigured(): Promise<void> {
  const priceIds = PRICE_ENV_KEYS
    .map((key) => Deno.env.get(key))
    .filter((id): id is string => !!id && id.trim() !== '' && id !== 'undefined' && id !== 'null')
    .map((id) => id.trim());

  if (priceIds.length === 0) {
    // No Dashboard price IDs configured — create-checkout-session falls back to
    // inline price_data for checkout, but the portal's subscription_update
    // feature can only offer a fixed list of real Price objects, so there is
    // nothing this can turn on. Leave the portal as whatever it already is.
    return;
  }

  const prices = await Promise.all(priceIds.map((id) => stripe.prices.retrieve(id)));
  const productIds = Array.from(new Set(prices.map((p) => (typeof p.product === 'string' ? p.product : p.product.id))));
  const products = productIds.map((product) => ({
    product,
    prices: prices.filter((p) => (typeof p.product === 'string' ? p.product : p.product.id) === product).map((p) => p.id),
  }));

  const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  const current = configs.data[0];

  const alreadyConfigured =
    current?.features?.subscription_update?.enabled === true &&
    current.features.subscription_update.proration_behavior === 'create_prorations' &&
    current.features.subscription_cancel?.enabled === true &&
    JSON.stringify(
      (current.features.subscription_update.products ?? [])
        .map((p) => ({ product: p.product, prices: [...p.prices].sort() }))
        .sort((a, b) => a.product.localeCompare(b.product)),
    ) ===
      JSON.stringify(
        products
          .map((p) => ({ product: p.product, prices: [...p.prices].sort() }))
          .sort((a, b) => a.product.localeCompare(b.product)),
      );
  if (alreadyConfigured) return;

  const features = {
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'] as Array<'price'>,
      proration_behavior: 'create_prorations' as const,
      products,
    },
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end' as const,
      cancellation_reason: { enabled: false, options: [] },
    },
  };

  if (current) {
    await stripe.billingPortal.configurations.update(current.id, { features });
  } else {
    await stripe.billingPortal.configurations.create({
      business_profile: {},
      features,
    });
  }
}

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

    try {
      await ensurePortalConfigured();
    } catch (configErr: any) {
      // The portal itself still opens without plan-switching if this fails —
      // better than blocking "Manage Billing" entirely over a config check.
      console.error('Could not verify/update billing portal configuration:', configErr.message || configErr);
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
