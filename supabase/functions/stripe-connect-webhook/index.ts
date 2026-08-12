// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe, cryptoProvider } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

// TryoutHQ's cut of every registration fee collected through Connect — kept in
// sync with create-registration-payment/index.ts.
const PLATFORM_FEE_RATE = 0.005;

serve(async (req: Request) => {
  const signature = req.headers.get('Stripe-Signature');

  if (!signature) {
    return new Response('No signature', { status: 400 });
  }

  try {
    const body = await req.text();
    // @ts-ignore: Deno global
    const webhookSecret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET') as string;

    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider);
    } catch (err: any) {
      console.error(`Connect webhook signature verification failed: ${err.message}`);
      return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as any;

        const { error } = await supabaseAdmin
          .from('accounts')
          .update({
            stripe_connect_charges_enabled: !!account.charges_enabled,
            stripe_connect_payouts_enabled: !!account.payouts_enabled,
          })
          .eq('stripe_connect_account_id', account.id);

        if (error) {
          console.error('Error updating connect status:', error);
        }
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as any;
        if (session.mode !== 'payment') break; // ignore the platform's own subscription checkouts

        const registrationId = session.metadata?.registrationId;
        const seasonRosterId = session.metadata?.seasonRosterId;
        const tryoutId = session.metadata?.tryoutId;
        const accountId = session.metadata?.accountId;
        if ((!registrationId && !seasonRosterId) || !accountId) {
          console.warn('checkout.session.completed missing registration/season_roster metadata, skipping');
          break;
        }

        const amountCents = session.amount_total ?? 0;
        const platformFeeCents = Math.round(amountCents * PLATFORM_FEE_RATE);

        const { error: paymentError } = await supabaseAdmin.from('payments').insert({
          account_id: accountId,
          tryout_id: tryoutId ?? null,
          registration_id: registrationId ?? null,
          season_roster_id: seasonRosterId ?? null,
          amount_cents: amountCents,
          currency: (session.currency ?? 'cad').toLowerCase(),
          status: 'paid',
          stripe_payment_intent_id: session.payment_intent as string,
          platform_fee_cents: platformFeeCents,
          received_at: new Date().toISOString(),
        });
        if (paymentError) {
          console.error('Error inserting payment:', paymentError);
        }

        if (registrationId) {
          const { error: regError } = await supabaseAdmin
            .from('registrations')
            .update({ payment_status: 'paid' })
            .eq('id', registrationId);
          if (regError) {
            console.error('Error updating registration payment status:', regError);
          }
        } else if (seasonRosterId) {
          const { error: rosterError } = await supabaseAdmin
            .from('season_roster')
            .update({ fee_status: 'paid' })
            .eq('id', seasonRosterId);
          if (rosterError) {
            console.error('Error updating season_roster fee status:', rosterError);
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
