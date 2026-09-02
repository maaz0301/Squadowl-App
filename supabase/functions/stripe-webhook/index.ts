// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe, cryptoProvider } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
// Email sending temporarily removed

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
            })
            .eq('id', accountId);
            
          if (error) {
            console.error('Error updating account plan tier:', error);
          } else {
            console.log('Successfully updated account to tier:', planTier);

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

        // Find the account by stripe_subscription_id
        const { data: account } = await supabaseAdmin
          .from('accounts')
          .select('id')
          .eq('stripe_subscription_id', subscription.id)
          .single();
          
        if (account) {
          const { error } = await supabaseAdmin
            .from('accounts')
            .update({
              subscription_status: subscription.status,
              // Optionally handle plan downgrades if deleted
              ...((subscription.status === 'canceled' || subscription.status === 'unpaid') ? { plan_tier: 'free' } : {})
            })
            .eq('id', account.id);
            
          if (error) {
            console.error('Error updating account subscription status:', error);
          } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
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
