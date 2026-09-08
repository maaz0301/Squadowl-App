import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'npm:stripe@18.5.0';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { resolveWebOrigin } from '../_shared/webOrigin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * This function's own Stripe client, deliberately *not* the shared one from
 * `_shared/stripe.ts`.
 *
 * `features.subscription_update.schedule_at_period_end` — the field that keeps
 * a downgrade from taking effect the instant it is chosen — does not exist on
 * the 2023-10-16 API version the shared client is pinned to. Bumping that
 * shared pin would change event and response shapes under every other function
 * (the webhooks, Connect, registration payments), so the newer SDK is scoped to
 * this file alone. Importing both here instead would collide: two copies of the
 * Stripe types in one module graph, and the shared client's pinned apiVersion
 * stops typechecking against the newer package.
 *
 * Portal sessions are created with this client too, for the same reason — the
 * only parameters used (`customer`, `return_url`) and the only field read back
 * (`url`) are identical across both versions.
 */
const stripePortal = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  httpClient: Stripe.createFetchHttpClient(),
});

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
 * The two settings below split plan changes by direction:
 *
 * `always_invoice` — an upgrade is charged and applied *now*. Under the
 * previous `create_prorations` the new tier was granted immediately but the
 * prorated difference was only parked on the next invoice, so upgrading in
 * September produced "your next payment will be CA$159.99" a full year out and
 * nothing charged today. Always invoicing settles the difference at the moment
 * the customer asks for it, which is what an upgrade is expected to do.
 *
 * `schedule_at_period_end` on `decreasing_item_amount` — a downgrade is
 * scheduled rather than applied. Stripe keeps the customer on the plan they
 * have already paid for until the term ends and swaps the price at renewal,
 * instead of dropping their features mid-term and leaving a credit behind.
 * The condition is evaluated by Stripe per update, so the same configuration
 * gives immediate upgrades and deferred downgrades with no branching here.
 *
 * Downgrading to Free has no Stripe price to switch to — it only exists as
 * cancelling the subscription outright, which is why planChangeRoute() sends
 * Free here too. `subscription_cancel` is turned on for that, `at_period_end`
 * so the account keeps what it already paid for through the current term,
 * consistent with the downgrade behaviour above.
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

  const prices = await Promise.all(priceIds.map((id) => stripePortal.prices.retrieve(id)));
  const productIds = Array.from(new Set(prices.map((p) => (typeof p.product === 'string' ? p.product : p.product.id))));
  const products = productIds.map((product) => ({
    product,
    prices: prices.filter((p) => (typeof p.product === 'string' ? p.product : p.product.id) === product).map((p) => p.id),
  }));

  const configs = await stripePortal.billingPortal.configurations.list({ is_default: true, limit: 1 });
  const current = configs.data[0];

  const update = current?.features?.subscription_update;
  const alreadyConfigured =
    update?.enabled === true &&
    update.proration_behavior === 'always_invoice' &&
    // Deferred downgrades are the whole point of the split, so a configuration
    // missing the condition has to be rewritten even if everything else matches.
    (update.schedule_at_period_end?.conditions ?? []).some(
      (c) => c.type === 'decreasing_item_amount',
    ) &&
    current.features.subscription_cancel?.enabled === true &&
    JSON.stringify(
      (update.products ?? [])
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
      // Upgrades: charged and applied immediately.
      proration_behavior: 'always_invoice' as const,
      // Downgrades: deferred to renewal instead of applied mid-term.
      schedule_at_period_end: {
        conditions: [{ type: 'decreasing_item_amount' as const }],
      },
      products,
    },
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end' as const,
      cancellation_reason: { enabled: false, options: [] },
    },
  };

  if (current) {
    await stripePortal.billingPortal.configurations.update(current.id, { features });
  } else {
    await stripePortal.billingPortal.configurations.create({
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

    const session = await stripePortal.billingPortal.sessions.create({
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
