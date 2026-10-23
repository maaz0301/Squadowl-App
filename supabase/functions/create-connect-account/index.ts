import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { resolvePrimaryMembership } from '../_shared/membership.ts';
import { resolveWebOrigin } from '../_shared/webOrigin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Stripe refuses POST /v1/accounts on newer platform accounts ("Create connected
 * accounts with POST /v2/core/accounts instead"), at every API version. So the
 * connected account is created through Accounts v2, set up the way a Standard
 * account was: Stripe collects fees and covers losses, and the coach gets the
 * full Stripe dashboard. Everything after creation is unchanged: v1 still reads
 * such an account as type "standard" with charges_enabled / payouts_enabled,
 * and v1 Account Links onboard it.
 */
async function createConnectedAccount(email: string | undefined, accountId: string): Promise<string> {
  const res = await fetch('https://api.stripe.com/v2/core/accounts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,
      'Stripe-Version': '2026-09-30.endive',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contact_email: email,
      identity: { country: 'CA' },
      dashboard: 'full',
      defaults: {
        responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
      },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
      },
      metadata: { accountId },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.id) {
    console.error('Stripe v2 account create failed:', JSON.stringify(body?.error ?? body));
    throw new Error(
      "We couldn't set up payouts with Stripe right now. Please try again in a moment, and contact support if it keeps happening.",
    );
  }
  return body.id as string;
}

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
    const membership = await resolvePrimaryMembership(user.id, 'id, stripe_connect_account_id');
    const accountId = membership.accountId;
    let connectAccountId: string | null = membership.account?.stripe_connect_account_id ?? null;

    if (!connectAccountId) {
      connectAccountId = await createConnectedAccount(user.email ?? undefined, accountId);

      // Must not fail silently. The Stripe account exists the moment create()
      // returns, but nothing links it to this org until this write lands — so a
      // dropped error leaves an orphan account in Stripe and a null column here,
      // and the coach's *next* tap creates yet another one, each time restarting
      // onboarding from scratch. Surfacing it means one recoverable error
      // instead of a pile of abandoned Connect accounts.
      const { error: linkError } = await supabaseAdmin
        .from('accounts')
        .update({ stripe_connect_account_id: connectAccountId })
        .eq('id', accountId);
      if (linkError) {
        console.error(
          `Created Stripe account ${connectAccountId} but failed to link it to account ${accountId}:`,
          linkError.message,
        );
        throw new Error(
          `Stripe account created but could not be saved (${connectAccountId}). Please retry, if this repeats, contact support with that id.`,
        );
      }
    } else {
      // The account.updated webhook is what normally keeps these flags in
      // sync, but it depends on a Connect-specific webhook endpoint + signing
      // secret being configured correctly in Stripe — easy to get wrong, and
      // silent when it is (Stripe just drops the event on signature
      // mismatch). Re-checking the account directly here means the coach's
      // status self-heals the next time they open this screen even if that
      // webhook is misconfigured or hasn't fired yet.
      const liveAccount = await stripe.accounts.retrieve(connectAccountId);
      const { error: syncError } = await supabaseAdmin
        .from('accounts')
        .update({
          stripe_connect_charges_enabled: !!liveAccount.charges_enabled,
          stripe_connect_payouts_enabled: !!liveAccount.payouts_enabled,
        })
        .eq('id', accountId);
      // Not fatal — the coach can still finish onboarding through the link
      // below, and connect-account-status re-syncs on the next Payments visit.
      if (syncError) {
        console.error('Failed to sync connect flags from live account:', syncError.message);
      }
    }

    // Account Links reject anything but a real http(s) URL for return_url/
    // refresh_url, so the mobile app's aastryout:// scheme can't be used directly.
    // The web client sends its own origin (allow-listed, see webOrigin.ts) and
    // Stripe returns straight to its Payments page. Mobile has no origin, so it
    // goes through connect-return, which redirects into the app's deep link.
    let webOrigin: string | null = null;
    try {
      const body = await req.json();
      webOrigin = resolveWebOrigin(body?.origin);
    } catch {
      // No JSON body (mobile): fall back to connect-return below.
    }
    const functionsBase = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}/functions/v1`;
    const refreshUrl = webOrigin
      ? `${webOrigin}/payments?connect_refresh=true`
      : `${functionsBase}/connect-return?connect_refresh=true`;
    const returnUrl = webOrigin
      ? `${webOrigin}/payments?connect_return=true`
      : `${functionsBase}/connect-return?connect_return=true`;

    const accountLink = await stripe.accountLinks.create({
      account: connectAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
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
