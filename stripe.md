# Shifting to a different Stripe account

Everything in this app — subscription billing (Coach/Coach+/Club) and registration-fee
collection (Stripe Connect) — is wired to a single Stripe account via the secrets stored in
Supabase. "Shifting the client account" means pointing that wiring at a different Stripe account
(e.g. moving off a developer/sandbox account onto the client's own production Stripe account).

Stripe has no built-in way to move data between two separate accounts — API keys, customers,
subscriptions, connected accounts, and webhook registrations all belong to one specific account
and don't transfer. So this is a **cutover**, not a migration: set up the new account in full,
point the app at it, and treat existing Stripe-side records under the old account as retired.

## What's tied to the Stripe account

| Thing | Where it lives | Carries over? |
|---|---|---|
| `STRIPE_SECRET_KEY` | Supabase function secret | No — new account has its own |
| `STRIPE_WEBHOOK_SECRET` (platform subscriptions) | Supabase function secret | No — new endpoint, new secret |
| `STRIPE_CONNECT_WEBHOOK_SECRET` (registration fees) | Supabase function secret | No — new endpoint, new secret |
| `STRIPE_PRICE_ID_*` (9 env vars, see below) | Supabase function secrets | No — must recreate products/prices |
| Connect platform activation | Stripe account setting | No — must re-enable on new account |
| `accounts.stripe_customer_id` | Supabase `accounts` table | No — customer only exists on old account |
| `accounts.stripe_subscription_id` | Supabase `accounts` table | No — subscription only exists on old account |
| `accounts.stripe_connect_account_id` | Supabase `accounts` table | No — connected account only exists on old account |
| Payment history (`payments` table) | Supabase `payments` table | Yes — it's just a record of past amounts, not live Stripe state |

The price ID secrets are: `STRIPE_PRICE_ID_COACH_MONTHLY`, `STRIPE_PRICE_ID_COACH_YEARLY`,
`STRIPE_PRICE_ID_COACH_PLUS_MONTHLY`, `STRIPE_PRICE_ID_COACH_PLUS_YEARLY`,
`STRIPE_PRICE_ID_CLUB_MONTHLY`, `STRIPE_PRICE_ID_CLUB_YEARLY`. (`STRIPE_PRICE_ID_COACH`,
`STRIPE_PRICE_ID_CLUB`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_ASSOCIATION` are legacy/unused —
no need to recreate those.) None of these are strictly required:
[create-checkout-session](supabase/functions/create-checkout-session/index.ts) falls back to
building the price inline (`price_data`) with the hardcoded CAD amounts from `plans.ts` if the
matching env var is unset. Setting real Price IDs is still worth doing on the client's account so
Stripe's own reporting/dashboard groups charges by plan correctly.

## Steps

### 1. Create/access the new Stripe account
Confirm which mode you're setting up first — get **test mode** fully verified before touching
live keys.

### 2. Recreate the subscription products
In the new account, create three products (Coach, Coach+, Club) each with a monthly and yearly
CAD price, matching `PLAN_DEFINITIONS` in [plans.ts](src/data/plans.ts):

| Plan | Monthly | Yearly |
|---|---|---|
| Coach | CAD$4.00 | CAD$39.99 |
| Coach+ | CAD$7.00 | CAD$69.99 |
| Club | CAD$10.00 | CAD$99.99 |

Copy each price's ID (`price_...`).

### 3. Enable Stripe Connect on the new account
Dashboard → Connect → Get started → choose **Standard accounts**. Fill in the platform profile
and accept the agreement. (Full walkthrough: see the Stripe Connect setup guide already shared.)
Every coach who was connected under the old account will need to reconnect from scratch —
Standard connected accounts belong to the platform account that created them and can't be
reassigned.

### 4. Register two webhook endpoints
Both point at this project's Supabase functions, just registered fresh under the new account:

- **Platform webhook** → `https://jvkrgejmbuplxznnhspa.supabase.co/functions/v1/stripe-webhook`
  Events: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_succeeded`
- **Connect webhook** → `https://jvkrgejmbuplxznnhspa.supabase.co/functions/v1/stripe-connect-webhook`
  Register this one from the Connect webhooks section specifically (not the regular one), so it
  receives connected-account events. Events: `account.updated`, `checkout.session.completed`

  (`jvkrgejmbuplxznnhspa` is this project's current Supabase project ref — if you're also moving
  to a different Supabase project as part of this cutover, swap in the new one.)

Copy each endpoint's signing secret (`whsec_...`).

### 5. Update Supabase secrets
```bash
npx supabase secrets set \
  STRIPE_SECRET_KEY=sk_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_CONNECT_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_ID_COACH_MONTHLY=price_... \
  STRIPE_PRICE_ID_COACH_YEARLY=price_... \
  STRIPE_PRICE_ID_COACH_PLUS_MONTHLY=price_... \
  STRIPE_PRICE_ID_COACH_PLUS_YEARLY=price_... \
  STRIPE_PRICE_ID_CLUB_MONTHLY=price_... \
  STRIPE_PRICE_ID_CLUB_YEARLY=price_...
```
No redeploy needed — functions read secrets at request time.

### 6. Clear stale Stripe references in the database
Every account row still points at customer/subscription/connect IDs that only exist on the old
Stripe account. Reset them so the app doesn't try to reuse dead IDs (it'll otherwise hit "no such
customer" errors on the next checkout attempt):

```sql
update public.accounts
set
  stripe_customer_id = null,
  stripe_subscription_id = null,
  stripe_connect_account_id = null,
  stripe_connect_charges_enabled = false,
  stripe_connect_payouts_enabled = false;
```

This doesn't touch `plan_tier` or anything else — accounts keep whatever plan they're on, they'll
just generate a fresh Stripe customer next time they open a checkout, and coaches will need to
tap "Connect with Stripe" again.

Leave the `payments` table alone — it's a historical ledger, not something Stripe needs to agree
with going forward. Nothing in the app ever calls back to Stripe using `stripe_payment_intent_id`
(no refund flow exists yet), so stale IDs there are inert.

You can also leave `registrations.stripe_checkout_session_id` as-is on any unpaid registrations —
[create-registration-payment](supabase/functions/create-registration-payment/index.ts) tries to
reuse that session first, but it's wrapped in a try/catch that falls back to creating a fresh one
the moment the retrieve fails (which it will, since the old session belongs to the retired
connected account). A guardian who re-tries the pay step just gets a new session under the new
account with no manual cleanup needed.

### 7. Test before calling it done
- [ ] Upgrade a test account Free → Coach → confirm `accounts.plan_tier` updates via the
      `stripe-webhook` function
- [ ] Cancel that subscription → confirm it downgrades back to `free`
- [ ] Connect a coach's payouts (Payments screen → Connect with Stripe) → confirm
      `stripe_connect_charges_enabled` flips to `true`
- [ ] Set a registration fee on an assessment, register as a test guardian, pay with
      `4242 4242 4242 4242` → confirm a `payments` row lands with the right
      `platform_fee_cents` and the registration's `payment_status` becomes `paid`

### 8. Go live
Repeat steps 2–6 in live mode once test mode is fully verified, using live keys/price
IDs/webhook secrets instead of test ones.
