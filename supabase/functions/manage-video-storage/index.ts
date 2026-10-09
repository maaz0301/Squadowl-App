// Changes, cancels or resumes an account's video storage add-on (Stripe).
//
// Cancelling deletes every stored video at the end of the paid period, so the
// request must carry the word DELETE exactly, typed by the coach on the second
// cancellation screen. The server checks it as well as the app, so a modified
// client cannot skip the warning.
//
//   POST { action: 'change', storageGb: 1 | 5 | 20 }
//   POST { action: 'cancel', confirm: 'DELETE' }
//   POST { action: 'resume' }
//
// Add-ons bought through the App Store or Google Play are managed in those
// stores; this function only handles Stripe subscriptions.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** CAD cents per year. Mirrors VIDEO_STORAGE_PRICES_CAD in create-checkout-session. */
const PRICES_CAD: Record<number, number> = { 1: 1500, 5: 2500, 20: 4000 };
const BYTES_PER_GB = 1073741824;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

/** The Stripe price for a storage size: the configured Dashboard price, else one created on demand. */
async function priceForGb(gb: number): Promise<string> {
  const configured = Deno.env.get(`STRIPE_PRICE_ID_VIDEO_STORAGE_${gb}GB_YEARLY`)?.trim();
  if (configured && configured !== 'undefined' && configured !== 'null') return configured;
  const price = await stripe.prices.create({
    currency: 'cad',
    unit_amount: PRICES_CAD[gb],
    recurring: { interval: 'year' },
    product_data: { name: `SquadOwl Video Storage ${gb} GB` },
  });
  return price.id;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, storageGb: rawGb, confirm } = await req.json();

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) throw new Error('User not found');

    // Same account lookup as create-checkout-session; only an owner or admin may change billing.
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('memberships')
      .select('account_id, role')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (membershipError || !membership) throw new Error('Only the account owner can change video storage.');
    const accountId = membership.account_id as string;

    const { data: account, error: accountError } = await supabaseAdmin
      .from('accounts')
      .select('plan_tier, video_storage_gb, video_storage_source, video_storage_sub_id, video_storage_cancel_at')
      .eq('id', accountId)
      .single();
    if (accountError || !account) throw new Error('Account not found');

    if (!account.video_storage_sub_id || (account.video_storage_gb ?? 0) <= 0) {
      throw new Error('This account has no video storage to change.');
    }
    if (account.video_storage_source !== 'stripe') {
      throw new Error(
        account.video_storage_source === 'apple'
          ? 'This storage was bought through the App Store. Manage it in your Apple subscriptions.'
          : 'This storage was bought through Google Play. Manage it in your Google Play subscriptions.',
      );
    }
    const subscriptionId = account.video_storage_sub_id as string;

    if (action === 'change') {
      const gb = Number(rawGb);
      if (!PRICES_CAD[gb]) throw new Error('Choose 1 GB, 5 GB or 20 GB.');
      if (gb === account.video_storage_gb) throw new Error('That is already your storage size.');

      const { data: used, error: usedError } = await supabaseAdmin.rpc('video_storage_used_bytes', { a: accountId });
      if (usedError) throw new Error(usedError.message);
      if (Number(used) > gb * BYTES_PER_GB) {
        throw new Error(
          `You are using more than ${gb} GB. Delete some videos before switching to a smaller size.`,
        );
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const itemId = subscription.items.data[0]?.id;
      if (!itemId) throw new Error('Could not find the storage subscription item.');
      const isUpgrade = gb > (account.video_storage_gb as number);
      await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: await priceForGb(gb) }],
        // An upgrade is charged for the rest of the term now; a downgrade just
        // changes the price from the next renewal, with no refund for this one.
        proration_behavior: isUpgrade ? 'always_invoice' : 'none',
        metadata: { accountId, type: 'video_storage', storageGb: String(gb) },
      });

      const cancelAt = account.video_storage_cancel_at ?? null;
      const { error } = await supabaseAdmin.rpc('set_video_storage', {
        p_account_id: accountId,
        p_gb: gb,
        p_source: 'stripe',
        p_subscription_id: subscriptionId,
        p_cancel_at: cancelAt,
      });
      if (error) throw new Error(error.message);
      return json({ ok: true, storageGb: gb });
    }

    if (action === 'cancel') {
      if (confirm !== 'DELETE') throw new Error('Type DELETE exactly to confirm.');
      const updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
      const endSec = (updated as any).cancel_at ?? (updated as any).current_period_end;
      const cancelAt = endSec ? new Date(endSec * 1000).toISOString() : null;

      const { error } = await supabaseAdmin.rpc('set_video_storage', {
        p_account_id: accountId,
        p_gb: account.video_storage_gb,
        p_source: 'stripe',
        p_subscription_id: subscriptionId,
        p_cancel_at: cancelAt,
      });
      if (error) throw new Error(error.message);
      // set_video_storage clears the acknowledgement only when it clears cancel_at, so record it after.
      await supabaseAdmin.from('accounts').update({ video_deletion_ack_at: new Date().toISOString() }).eq('id', accountId);
      return json({ ok: true, cancelAt });
    }

    if (action === 'resume') {
      await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
      const { error } = await supabaseAdmin.rpc('set_video_storage', {
        p_account_id: accountId,
        p_gb: account.video_storage_gb,
        p_source: 'stripe',
        p_subscription_id: subscriptionId,
        p_cancel_at: null,
      });
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    throw new Error('Unknown action.');
  } catch (err: any) {
    console.error('Error in manage-video-storage:', err.message || err);
    return json({ error: err.message || 'Internal server error' }, 400);
  }
});
