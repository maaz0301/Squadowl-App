// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe, cryptoProvider } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
// Email sending temporarily removed

/**
 * Maps a Stripe price back to a plan tier, for reconciling `accounts.plan_tier`
 * after a subscription's price changes outside `checkout.session.completed` —
 * a Customer Portal plan switch (upgrade or downgrade) fires only
 * `customer.subscription.updated`, which used to leave `plan_tier` untouched
 * entirely, so a Club account that switched down to Coach+ in the portal kept
 * showing (and enforcing) Club limits forever while Stripe billed them at the
 * Coach+ rate.
 *
 * Same two-step resolution as create-checkout-session's own price lookup:
 * a configured `STRIPE_PRICE_ID_*` first, then a fallback match on the
 * hardcoded CAD amount for tiers whose checkout used inline `price_data`
 * (no Dashboard price ID configured) — see TIER_PRICES_CAD below, which
 * mirrors PLAN_DEFINITIONS in src/data/plans.ts.
 */
function buildPriceIdToTier(): Record<string, string> {
  const map: Record<string, string> = {};
  const envKeys: [string, string][] = [
    ['STRIPE_PRICE_ID_COACH_MONTHLY', 'coach'],
    ['STRIPE_PRICE_ID_COACH_YEARLY', 'coach'],
    ['STRIPE_PRICE_ID_COACH_PLUS_MONTHLY', 'coach_plus'],
    ['STRIPE_PRICE_ID_COACH_PLUS_YEARLY', 'coach_plus'],
    ['STRIPE_PRICE_ID_CLUB_MONTHLY', 'club'],
    ['STRIPE_PRICE_ID_CLUB_YEARLY', 'club'],
  ];
  for (const [envKey, tier] of envKeys) {
    // @ts-ignore: Deno global
    const id = Deno.env.get(envKey);
    if (id && id.trim() !== '' && id !== 'undefined' && id !== 'null') map[id.trim()] = tier;
  }
  return map;
}

/** free < coach < coach_plus < club, mirroring TIER_ORDER/getTierRank in src/data/plans.ts. */
const TIER_ORDER = ['free', 'coach', 'coach_plus', 'club'];

/** Mirrors TIER_PRICES_CAD in create-checkout-session and PLAN_DEFINITIONS in src/data/plans.ts. */
const TIER_PRICES_CAD: Record<string, { year: number; month: number }> = {
  coach: { year: 3999, month: 400 },
  coach_plus: { year: 6999, month: 700 },
  club: { year: 9999, month: 1000 },
};

function resolveTierFromAmount(unitAmount: number | null | undefined, interval: string | undefined, currency: string | undefined): string | null {
  if (unitAmount == null || currency?.toLowerCase() !== 'cad') return null;
  const key = interval === 'month' ? 'month' : interval === 'year' ? 'year' : null;
  if (!key) return null;
  for (const [tier, prices] of Object.entries(TIER_PRICES_CAD)) {
    if (prices[key as 'year' | 'month'] === unitAmount) return tier;
  }
  return null;
}

/**
 * The plan tier `subscription`'s current price corresponds to, or null when it
 * can't be resolved (a legacy/retired price, or one this mapping doesn't know
 * about) — callers must leave `plan_tier` alone rather than guess wrong.
 */
async function resolvePlanTierFromSubscription(
  subscription: any,
  priceIdToTier: Record<string, string>,
): Promise<string | null> {
  const item = subscription.items?.data?.[0];
  let price = item?.price;
  if (!price) return null;
  // Webhook payloads normally carry the full Price object on a subscription
  // item, but fetch it if a leaner payload ever hands back just the id.
  if (typeof price === 'string') {
    try {
      price = await stripe.prices.retrieve(price);
    } catch (err: any) {
      console.error('Could not retrieve price for tier resolution:', err.message || err);
      return null;
    }
  }
  if (price.id && priceIdToTier[price.id]) return priceIdToTier[price.id];
  return resolveTierFromAmount(price.unit_amount, price.recurring?.interval, price.currency);
}

/**
 * Cancels every *other* plan subscription on the customer once a checkout has
 * created a new one.
 *
 * Cancelled immediately and with `prorate: false`, matching the upgrade's own
 * billing model: the customer has just paid a full year for the new tier, and
 * the time left on the old one is deliberately neither credited nor refunded.
 * A proration credit here would quietly hand back exactly what that model is
 * meant to forfeit.
 *
 * Add-on team licenses are left strictly alone. They are a second subscription
 * by design, they carry no plan price, and resolvePlanTierFromSubscription
 * returns null for them — so anything unrecognised is skipped rather than
 * cancelled. That also protects a subscription on a retired or hand-made price
 * from being torn down on a guess.
 *
 * Failures are logged, never thrown: the account is already on the new tier by
 * this point, and failing the webhook would only make Stripe redeliver an
 * event whose database work is done.
 */
async function cancelSupersededSubscriptions(session: any, newTier: string): Promise<void> {
  const newSubId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;
  if (!newSubId || !customerId) return;

  try {
    const all = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    const priceIdToTier = buildPriceIdToTier();
    const LIVE = ['active', 'trialing', 'past_due', 'unpaid'];

    for (const sub of all.data) {
      if (sub.id === newSubId) continue;
      if (!LIVE.includes(sub.status)) continue;

      const tier = await resolvePlanTierFromSubscription(sub, priceIdToTier);
      if (!tier) continue;

      try {
        await stripe.subscriptions.cancel(sub.id, { prorate: false });
        console.log(
          `Cancelled superseded ${tier} subscription ${sub.id} after upgrading to ${newTier} ` +
            `via checkout session ${session.id}.`,
        );
      } catch (err: any) {
        console.error(`Could not cancel superseded subscription ${sub.id}:`, err.message || err);
      }
    }
  } catch (err: any) {
    console.error('Could not list subscriptions to cancel superseded ones:', err.message || err);
  }
}

/**
 * The plan change already scheduled against `subscription`, if any — the tier
 * it moves to and when.
 *
 * Only a *different* tier counts. A subscription schedule is also created for
 * ordinary reasons (Stripe attaches one whenever a phase list is needed at
 * all), and a next phase carrying the price the account is already on is not a
 * pending change worth telling anyone about.
 *
 * Returns null on anything it cannot read cleanly: an unresolvable price, a
 * schedule that has been released, a retrieve that fails. A missing banner is
 * a much smaller problem than a wrong one.
 */
async function resolvePendingPlanChange(
  subscription: any,
  currentTier: string,
  priceIdToTier: Record<string, string>,
): Promise<{ tier: string; at: number } | null> {
  const scheduleRef = subscription?.schedule;
  if (!scheduleRef) return null;
  const scheduleId = typeof scheduleRef === 'string' ? scheduleRef : scheduleRef.id;
  if (!scheduleId) return null;

  try {
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
    if (schedule.status === 'released' || schedule.status === 'canceled') return null;

    const now = Math.floor(Date.now() / 1000);
    const nextPhase = (schedule.phases ?? []).find((p: any) => p.start_date > now);
    if (!nextPhase) return null;

    const priceRef = nextPhase.items?.[0]?.price;
    const priceId = typeof priceRef === 'string' ? priceRef : priceRef?.id;
    if (!priceId) return null;

    const tier = priceIdToTier[priceId];
    if (!tier || tier === currentTier) return null;

    return { tier, at: nextPhase.start_date };
  } catch (err: any) {
    console.warn('Could not read subscription schedule for a pending plan change:', err.message || err);
    return null;
  }
}

/**
 * Cancels the account's video storage subscription once its plan has fallen
 * below Coach+. The storage then lapses (set_video_storage via the resulting
 * customer.subscription.deleted event) and the maintenance function deletes the
 * videos. Failures are logged, not thrown: the plan reconcile already succeeded.
 */
async function cancelOrphanedVideoStorage(accountId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('accounts')
      .select('video_storage_sub_id, video_storage_source')
      .eq('id', accountId)
      .maybeSingle();
    if (data?.video_storage_sub_id && data.video_storage_source === 'stripe') {
      await stripe.subscriptions.cancel(data.video_storage_sub_id, { prorate: false });
      console.log(`Cancelled video storage subscription ${data.video_storage_sub_id} for account ${accountId}.`);
    }
  } catch (err: any) {
    console.error('Could not cancel orphaned video storage subscription:', err.message || err);
  }
}

/**
 * Storage size of a video storage subscription. A plan change made in Stripe's own page does not
 * touch the metadata, so the price is read first: prices this app creates carry a lookup key naming
 * their size. Older subscriptions have none and keep the size in their metadata, where the retired
 * 20 GB size becomes the new 25 GB Pro size. The amount is the last resort.
 */
function storageGbOf(subscription: any): number {
  const price = subscription.items?.data?.[0]?.price;
  const fromKey = /^squadowl_video_storage_(\d+)gb_yearly$/.exec(price?.lookup_key ?? '');
  const valid = [1, 5, 25, 100];
  if (fromKey && valid.includes(Number(fromKey[1]))) return Number(fromKey[1]);
  const fromMeta = Number(subscription.metadata?.storageGb) || 0;
  if (fromMeta === 20) return 25;
  if (valid.includes(fromMeta)) return fromMeta;
  const bySize: Record<number, number> = { 2500: 1, 5000: 5, 15000: 25, 35000: 100 };
  return bySize[price?.unit_amount] ?? 0;
}

serve(async (req: Request) => {
  const signature = req.headers.get('Stripe-Signature');
  
  if (!signature) {
    return new Response('No signature', { status: 400 });
  }

  try {
    const body = await req.text();
    // @ts-ignore: Deno global
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') as string;
    
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider);
    } catch (err: any) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('Received checkout.session.completed:', session.id);
        console.log('Metadata:', session.metadata);
        
        const accountId = session.metadata?.accountId;
        const planTier = session.metadata?.planTier?.toLowerCase();
        console.log('Extracted accountId:', accountId, 'planTier:', planTier);

        // Loyalty credit spent on this checkout. Debited here rather than when
        // the session was created so an abandoned checkout doesn't burn it.
        // Runs before the team-license branch below, which returns early.
        const referralCreditsCents = Math.round(Number(session.metadata?.referralCreditsCents) || 0);
        if (accountId && referralCreditsCents > 0) {
          const { data: debited, error: redeemError } = await supabaseAdmin.rpc(
            'record_referral_redemption',
            {
              p_account_id: accountId,
              p_session_id: session.id,
              p_amount_cents: referralCreditsCents,
            },
          );
          if (redeemError) {
            // The customer already got the discount from Stripe, so failing the
            // webhook would only re-run the rest of this handler. Log it and let
            // the ledger be reconciled by hand instead.
            console.error('Error recording referral redemption:', redeemError);
          } else if (debited === null) {
            console.log('Referral redemption already recorded for session:', session.id);
          } else {
            console.log(`Debited ${debited} cents of loyalty credit from account ${accountId}.`);
          }
        }

        // A founder discount code used on this checkout. Recorded here, not when
        // the session was created, so only completed checkouts count toward the
        // code's limits. Idempotent on the session id.
        const discountCodeId = session.metadata?.discountCodeId;
        if (accountId && discountCodeId) {
          const { data: redemption, error: discountError } = await supabaseAdmin.rpc(
            'record_discount_redemption',
            {
              p_code_id: discountCodeId,
              p_account_id: accountId,
              p_session_id: session.id,
              p_plan_tier: planTier ?? null,
              p_discount_cents: Math.round(Number(session.total_details?.amount_discount) || 0),
            },
          );
          if (discountError) {
            // The customer already has the discount; don't make Stripe redeliver
            // the whole event over the bookkeeping.
            console.error('Error recording discount code redemption:', discountError);
          } else if (redemption === null) {
            console.log('Discount code redemption already recorded for session:', session.id);
          } else {
            console.log(`Recorded discount code ${session.metadata?.discountCode} for account ${accountId}.`);
          }
        }

        // Video storage add-on: switches the account's storage size on. It is state, not a
        // counter, so a redelivered event just writes the same values again.
        if (accountId && session.metadata?.type === 'video_storage') {
          const gb = Number(session.metadata?.storageGb) || 0;
          const { error } = await supabaseAdmin.rpc('set_video_storage', {
            p_account_id: accountId,
            p_gb: gb,
            p_source: 'stripe',
            p_subscription_id: (session.subscription as string) ?? null,
            p_cancel_at: null,
          });
          if (error) {
            console.error('Error activating video storage:', error);
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
          }
          console.log(`Video storage ${gb} GB active for account ${accountId}.`);
          break;
        }

        // Add-on team licenses (Club: CAD$10/team/year beyond the 6 included) carry no
        // planTier — they raise the team cap and must leave the subscription tier alone.
        if (accountId && session.metadata?.type === 'team_license') {
          const quantity = Math.max(1, Math.round(Number(session.metadata?.quantity) || 1));
          const { data: newTotal, error } = await supabaseAdmin.rpc('grant_team_licenses', {
            p_account_id: accountId,
            p_session_id: session.id,
            p_quantity: quantity,
            p_subscription_id: (session.subscription as string) ?? null,
          });
          if (error) {
            console.error('Error granting team licenses:', error);
            // Surface the failure so Stripe retries — grant_team_licenses is idempotent
            // on the session id, so a retry can't double-grant.
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
          }
          if (newTotal === null) {
            console.log('Team licenses already granted for session:', session.id);
          } else {
            console.log(`Granted ${quantity} team license(s); account now has ${newTotal}.`);
          }
          break;
        }

        if (accountId && planTier) {
          console.log('Updating account in database...');
          // Update the account with the active subscription
          const { error } = await supabaseAdmin
            .from('accounts')
            .update({
              stripe_subscription_id: session.subscription as string,
              plan_tier: planTier,
              subscription_status: 'active',
              // A brand-new subscription is neither scheduled to end nor
              // scheduled to change tier; clear anything left over from a
              // previously cancelled or downgraded one.
              subscription_cancel_at: null,
              pending_plan_tier: null,
              pending_plan_change_at: null,
            })
            .eq('id', accountId);
            
          if (error) {
            console.error('Error updating account plan tier:', error);
          } else {
            console.log('Successfully updated account to tier:', planTier);

            // The subscription this checkout just created supersedes whatever
            // plan subscription was already running. Upgrades are deliberately
            // routed through Checkout so they bill a full year up front rather
            // than the prorated difference, and Checkout in subscription mode
            // always *adds* a subscription — so without this the customer goes
            // on paying for the tier they just left. That is exactly how one
            // account ended up billed for Coach, Coach+, Coach and Club at the
            // same time.
            await cancelSupersededSubscriptions(session, planTier);

            // This account just became a paid subscriber, so whoever referred
            // them earns CAD$1 (capped at CAD$60/year). A null result means
            // there was no referrer, they were already paid out, or the cap is
            // reached — all normal, none of them an error.
            const { data: awarded, error: awardError } = await supabaseAdmin.rpc(
              'award_referral_credit',
              { p_referred_account_id: accountId, p_session_id: session.id },
            );
            if (awardError) {
              console.error('Error awarding referral credit:', awardError);
            } else if (awarded !== null) {
              console.log(`Awarded ${awarded} cents of referral credit for account ${accountId}.`);
            }

            // Trigger send-email for upgrade
            const { data: owners } = await supabaseAdmin
              .from('memberships')
              .select('user_id')
              .eq('account_id', accountId)
              .in('role', ['owner', 'admin']);
            
            if (owners && owners.length > 0) {
              const ownerUserId = owners[0].user_id;
              const { data: userRecord } = await supabaseAdmin.auth.admin.getUserById(ownerUserId);
              if (userRecord?.user?.email) {
                console.log('Sending subscription_upgraded email to:', userRecord.user.email);
                await supabaseAdmin.functions.invoke('send-email', {
                  body: {
                    to: userRecord.user.email,
                    type: 'subscription_upgraded',
                    payload: { planTier }
                  }
                });
              }
            }
          }
        } else {
          console.warn('Missing accountId or planTier in metadata. Skipping database update.');
        }
        break;
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        // The video storage add-on is its own subscription. Its lifecycle moves the
        // storage entitlement only and never the plan tier. A scheduled cancellation
        // keeps the storage on until the paid period ends (cancel_at), which is when
        // the maintenance function deletes the videos.
        if (subscription.metadata?.type === 'video_storage' && subscription.metadata?.accountId) {
          const live =
            event.type !== 'customer.subscription.deleted' &&
            ['active', 'trialing', 'past_due'].includes(subscription.status);
          const cancelAtSec = subscription.cancel_at_period_end
            ? (subscription.cancel_at ?? subscription.current_period_end ?? null)
            : (subscription.cancel_at ?? null);
          const { error: storageError } = await supabaseAdmin.rpc('set_video_storage', {
            p_account_id: subscription.metadata.accountId,
            p_gb: live ? storageGbOf(subscription) : 0,
            p_source: 'stripe',
            p_subscription_id: subscription.id,
            p_cancel_at: live && cancelAtSec ? new Date(cancelAtSec * 1000).toISOString() : null,
          });
          if (storageError) {
            console.error('Error updating video storage:', storageError);
            return new Response(JSON.stringify({ error: storageError.message }), { status: 500 });
          }
          break;
        }

        // An add-on team-license subscription is a second subscription on the same
        // customer, so it never matches accounts.stripe_subscription_id below. Cancelling
        // it gives the extra teams back instead of touching the plan tier.
        if (event.type === 'customer.subscription.deleted' || subscription.status === 'canceled' || subscription.status === 'unpaid') {
          const { data: revokedTotal, error: revokeError } = await supabaseAdmin.rpc('revoke_team_licenses', {
            p_subscription_id: subscription.id,
          });
          if (revokeError) {
            console.error('Error revoking team licenses:', revokeError);
          } else if (revokedTotal !== null) {
            console.log(`Revoked team licenses for subscription ${subscription.id}; account now has ${revokedTotal}.`);
            break;
          }
        }

        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id;

        // Keyed on the customer, not the subscription. An account can carry
        // more than one subscription at once — an upgrade taken through
        // Checkout rather than the portal leaves the old one running alongside
        // the new, and add-on team licenses are always a second subscription —
        // but only ever one of them is stored in stripe_subscription_id, so
        // events for all the others matched nothing here and were dropped
        // silently. Cancelling one of three subscriptions did nothing at all.
        let account: { id: string; plan_tier: string } | null = null;
        if (customerId) {
          const { data } = await supabaseAdmin
            .from('accounts')
            .select('id, plan_tier')
            .eq('stripe_customer_id', customerId)
            .maybeSingle();
          account = data;
        }
        if (!account) {
          const { data } = await supabaseAdmin
            .from('accounts')
            .select('id, plan_tier')
            .eq('stripe_subscription_id', subscription.id)
            .maybeSingle();
          account = data;
        }

        if (account) {
          const updates: Record<string, unknown> = {};

          if (customerId) {
            // Recompute entitlement from every subscription this customer has,
            // rather than trusting the one that happened to fire this event:
            // with several live subscriptions the account is entitled to the
            // best of them, and only drops to Free once none of them entitle
            // anything any more. This is also what makes a cancellation
            // actually land — the previous code demoted on a single
            // subscription's status while the customer's others kept billing.
            const all = await stripe.subscriptions.list({
              customer: customerId,
              status: 'all',
              limit: 100,
            });
            const priceIdToTier = buildPriceIdToTier();
            // past_due keeps access, matching the old behaviour of only ever
            // demoting on 'canceled'/'unpaid'.
            const ENTITLING = ['active', 'trialing', 'past_due'];

            let bestTier = 'free';
            let bestRank = 0;
            let bestSubId: string | null = null;
            let bestStatus: string | null = null;
            let bestCancelAt: number | null = null;
            let bestSub: any = null;
            let entitlingCount = 0;
            let unresolvedCount = 0;

            for (const sub of all.data) {
              if (!ENTITLING.includes(sub.status)) continue;
              // Video storage is an add-on, not a plan: it never entitles or blocks a tier.
              if (sub.metadata?.type === 'video_storage') continue;
              entitlingCount++;
              // Team-license subscriptions resolve to no tier and are skipped.
              const tier = await resolvePlanTierFromSubscription(sub, priceIdToTier);
              if (!tier) {
                unresolvedCount++;
                continue;
              }
              const rank = TIER_ORDER.indexOf(tier);
              if (rank > bestRank) {
                bestRank = rank;
                bestTier = tier;
                bestSubId = sub.id;
                bestStatus = sub.status;
                bestSub = sub;
                // Portal cancellations are taken at period end, so the
                // subscription stays active and only this says it is ending.
                bestCancelAt = sub.cancel_at_period_end
                  ? (sub.cancel_at ?? sub.current_period_end ?? null)
                  : null;
              }
            }

            updates.subscription_status = bestStatus ?? subscription.status;
            updates.subscription_cancel_at = bestCancelAt
              ? new Date(bestCancelAt * 1000).toISOString()
              : null;

            // A downgrade chosen in the portal is scheduled, not applied: the
            // portal config defers `decreasing_item_amount` updates to period
            // end, so the subscription keeps its current price and Stripe
            // attaches a subscription schedule whose next phase carries the
            // lower one. Nothing about the subscription itself changes, so
            // without reading that schedule the app would show no trace of the
            // downgrade until it silently took effect a year later.
            const pending = await resolvePendingPlanChange(bestSub, bestTier, priceIdToTier);
            updates.pending_plan_tier = pending?.tier ?? null;
            updates.pending_plan_change_at = pending
              ? new Date(pending.at * 1000).toISOString()
              : null;

            // Only ever demote to Free when every live subscription was
            // positively identified. A price this mapping doesn't know — one
            // created through create-checkout-session's inline `price_data`
            // fallback, or a retired Dashboard price — resolves to no tier,
            // and treating that as "not entitled" would cut off an account
            // that is still paying. Leave the tier alone and say so instead.
            if (bestSubId) {
              updates.plan_tier = bestTier;
              // Point the account at the subscription actually backing its
              // tier, so anything still reading this single id follows it.
              updates.stripe_subscription_id = bestSubId;
            } else if (unresolvedCount > 0) {
              console.warn(
                `Account ${account.id} has ${unresolvedCount} live subscription(s) whose price could not be mapped to a plan tier. ` +
                  'Leaving plan_tier unchanged rather than demoting a paying account — check the STRIPE_PRICE_ID_* secrets against the Dashboard prices.',
              );
            } else if (entitlingCount === 0) {
              updates.plan_tier = 'free';
            }
          } else {
            // No customer on the event: fall back to the single-subscription
            // reading rather than guessing at the account's entitlement.
            updates.subscription_status = subscription.status;
            if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
              updates.plan_tier = 'free';
            }
          }

          const droppedToFree = account.plan_tier !== 'free' && updates.plan_tier === 'free';

          const { error } = await supabaseAdmin
            .from('accounts')
            .update(updates)
            .eq('id', account.id);

          if (error) {
            console.error('Error updating account subscription status:', error);
          } else {
            console.log(
              `Reconciled account ${account.id} to plan tier "${updates.plan_tier}" ` +
                `(status "${updates.subscription_status}") from customer ${customerId ?? 'unknown'}'s subscriptions.`,
            );
          }

          // Storage is a Coach+ and Club add-on. Once the plan is below that the videos are
          // going, so stop billing for the storage too.
          const reconciledTier = String(updates.plan_tier ?? account.plan_tier);
          if (!error && reconciledTier !== 'coach_plus' && reconciledTier !== 'club') {
            await cancelOrphanedVideoStorage(account.id);
          }

          if (!error && droppedToFree) {
            // Trigger send-email for cancellation
            const { data: owners } = await supabaseAdmin
              .from('memberships')
              .select('user_id')
              .eq('account_id', account.id)
              .in('role', ['owner', 'admin']);
            
            if (owners && owners.length > 0) {
              const ownerUserId = owners[0].user_id;
              const { data: userRecord } = await supabaseAdmin.auth.admin.getUserById(ownerUserId);
              if (userRecord?.user?.email) {
                console.log('Sending subscription_canceled email to:', userRecord.user.email);
                await supabaseAdmin.functions.invoke('send-email', {
                  body: {
                    to: userRecord.user.email,
                    type: 'subscription_canceled',
                    payload: {}
                  }
                });
              }
            }
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        
        const { data: account } = await supabaseAdmin
          .from('accounts')
          .select('id, name')
          .eq('stripe_customer_id', invoice.customer)
          .single();
          
        if (account) {
          const { error } = await supabaseAdmin.from('payments').insert({
            account_id: account.id,
            amount_cents: invoice.amount_paid,
            currency: invoice.currency,
            status: 'paid',
            stripe_payment_intent_id: invoice.payment_intent as string,
          });
          
          if (error) {
            console.error('Error inserting payment:', error);
          } else {
            // Send push notification to account owners
            const { data: owners } = await supabaseAdmin
              .from('memberships')
              .select('user_id')
              .eq('account_id', account.id)
              .in('role', ['owner', 'admin']);
              
            if (owners && owners.length > 0) {
              const userIds = owners.map((m: { user_id: string }) => m.user_id);
              await supabaseAdmin.functions.invoke('send-push-notification', {
                body: {
                  target_user_ids: userIds,
                  heading: 'Payment Successful',
                  content: `Your payment of ${(invoice.amount_paid / 100).toFixed(2)} ${invoice.currency.toUpperCase()} was successful.`,
                  data: { accountId: account.id }
                }
              });
            }
          }
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
