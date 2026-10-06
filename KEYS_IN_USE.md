# Keys in use

Which keys and secrets the project actually reads, and where. Checked against the
code in both repos and against the secrets set on the Supabase project
(`jvkrgejmbuplxznnhspa`) on 2026-10-07.

- **Names only.** No values are written here. Never paste a value into this file.
- **SendGrid is left out on purpose** (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`,
  `SENDGRID_FROM_NAME`). It is used by `send-email` in both repos and by
  `auth-send-email` and `founder-support` in the web repo.
- `ENVIRONMENT.md` is older and out of date (it still describes Resend and OpenAI).
  Trust this file over it.

How to set or change a secret on the project:

```bash
supabase secrets set NAME="value"
supabase secrets list        # names only
```

---

## 1. Used by the edge functions

| Key | Read by | What it is for | Set on project |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | `_shared/stripe.ts` (all payment functions), `create-portal-session`; `founder-billing` (web repo) | Talking to the Stripe API | Yes |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | Verifying Stripe's subscription webhooks | Yes |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `stripe-connect-webhook` | Verifying Stripe Connect webhooks (team fees, registration payments) | Yes |
| `STRIPE_PRICE_ID_<TIER>_<MONTHLY\|YEARLY>` | `stripe-webhook`, `create-checkout-session` | Mapping a Stripe price to a plan (see section 4) | Yes |
| `ANTHROPIC_API_KEY` | `generate-ai-insights`, `generate-test-players` | AI player summaries, report-card AI comments, test player generation | Yes |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | `send-push-notification` | Sending phone push notifications through Firebase Cloud Messaging. The full service-account JSON. | Yes |
| `SEND_EMAIL_HOOK_SECRET` | `auth-send-email` (web repo) | Verifying Supabase's "send email" auth hook | Yes |

## 2. Supplied by Supabase automatically

These are injected into every function. Do not set them by hand.

| Key | Used for |
|---|---|
| `SUPABASE_URL` | Every function that talks to the database |
| `SUPABASE_ANON_KEY` | Acting as the signed-in user (`resend-invite`, `delete-account`, `request-password-reset`, founder functions) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin access that bypasses row security (`_shared/supabaseAdmin.ts`, `generate-ai-insights`, `delete-account`, founder functions). Server only, never ship it in an app. |

## 3. Optional settings, read but not set (the defaults are used)

| Key | Read by | Default behavior |
|---|---|---|
| `APP_BASE_URL` | `send-email` | Links in emails point at `https://tryouthq.ca` |
| `EMAIL_LOGO_URL` | `send-email` | Email header logo comes from `https://tryouthq.ca/images/tryouthq_t_logo_v2.png` |
| `WEB_APP_URL` | `_shared/webOrigin.ts` | Falls back to the built-in web address |
| `PUBLIC_SITE_URL` | `auth-send-email` (web repo) | Falls back to the built-in site address |
| `SUPPORT_FROM_EMAIL` | `founder-support` (web repo) | Falls back to the built-in support address |

Set these only when the domain changes (for example the SquadOwl rename).

## 4. Stripe price IDs

`STRIPE_PRICE_ID_*` are read by name at run time, so a search for the exact name in
the code can miss them. In use:

- `STRIPE_PRICE_ID_COACH_MONTHLY`, `STRIPE_PRICE_ID_COACH_YEARLY`
- `STRIPE_PRICE_ID_COACH_PLUS_MONTHLY`, `STRIPE_PRICE_ID_COACH_PLUS_YEARLY`
- `STRIPE_PRICE_ID_CLUB_MONTHLY`, `STRIPE_PRICE_ID_CLUB_YEARLY`

If one is missing, checkout still works by building the price on the fly; it just
loses proper Stripe product reporting.

## 5. Used by the apps themselves (public settings, not secrets)

| App | Key | Used for |
|---|---|---|
| Mobile (`.env`) | `EXPO_PUBLIC_SUPABASE_URL` | Connecting to Supabase |
| Mobile (`.env`) | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase key (row security protects the data) |
| Mobile (`.env`) | `EXPO_PUBLIC_WEB_URL` | Building shareable links |
| Web (`.env.local`) | `NEXT_PUBLIC_SUPABASE_URL` | Connecting to Supabase |
| Web (`.env.local`) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase key |
| Web (`.env.local`) | `NEXT_PUBLIC_WEB_URL` | Building shareable links |

Firebase files for push on the phone (public app config, no private key):

- Android: `android/app/google-services.json`
- iOS: `ios/AASTryout/GoogleService-Info.plist`

**iPhone push is currently broken.** Firebase rejects iPhone registrations with
"Invalid APNs credential", so no iPhone gets pushes. The fix is in the Firebase
console, not in any secret here: upload an Apple push key (an APNs authentication
key) under Project settings > Cloud Messaging for the iOS app.

---

## 6. Set on the project but not read by any code

Nothing in either repo reads these. They look like leftovers from earlier setups.
Safe to remove once you are sure nothing outside this repo (a dashboard hook, a
script) uses them.

| Key | Likely origin |
|---|---|
| `OPENAI_API_KEY` | Earlier AI provider, replaced by Anthropic |
| `RESEND_API_KEY` | Earlier email provider, replaced by SendGrid |
| `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY` | Earlier push provider, replaced by Firebase |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` | Earlier email setup |
| `SENDER_EMAIL` | Earlier email setup |
| `STRIPE_PRICE_ID_COACH`, `STRIPE_PRICE_ID_CLUB`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_ASSOCIATION` | Old plan names without a billing interval. The Pro and Association plans are retired. |
| `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` | Added by Supabase itself. Leave them alone. |

---

## Handling rules

- The service role key, the Stripe keys, the Anthropic key and the Firebase
  service-account JSON are server secrets. They live only in Supabase secrets, never
  in an app, a repo, or a chat message.
- The `EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` values end up inside the shipped apps, so
  only public values belong there.
- If a secret is ever pasted somewhere it should not be, rotate it in its own
  dashboard (Stripe, Anthropic, Firebase, Supabase) and set the new value with
  `supabase secrets set`.
