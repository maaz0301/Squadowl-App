# Environment Variables & Third-Party Services Guide

This document tracks all the environment variables, secrets, and third-party services used across the Athlete Assessment project.

---

## 1. Frontend (React Native / Expo)

**Where to configure:**
- **Local Development:** Create a `.env` file in the root of the project (e.g., alongside `package.json`).
- **Production (EAS Build):** Add these as secrets in your Expo dashboard or `eas.json`.

### Variables
- `EXPO_PUBLIC_SUPABASE_URL`: Your Supabase Project URL. Used to initialize the Supabase client.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase Anon Public Key. Used to authenticate frontend requests.
- `EXPO_PUBLIC_WEB_URL`: (Optional) The base URL for your project (e.g., `https://aas-tryout.app`), used for generating shareable links.

*Note: The **OneSignal App ID** is currently hardcoded in `src/lib/OneSignalManager.ts`. If you change your OneSignal project, you will need to update the ID in that file.*

---

## 2. Backend (Supabase Edge Functions)

**Where to configure:**
- **Remote (Production):** Set secrets via the Supabase CLI in your terminal:
  ```bash
  npx supabase secrets set VAR_NAME="your_value"
  ```
- **Local Development:** Create a `.env.local` file inside the `supabase/` folder to test edge functions locally using `supabase functions serve`.

### Variables
#### Supabase Auth
- `SUPABASE_URL`: Automatically injected by Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: Automatically injected by Supabase. Used in `_shared/supabaseAdmin.ts` for admin-level database bypass access (e.g., auto-creating users).

#### Stripe (Payments & Subscriptions)
- `STRIPE_SECRET_KEY`: Used in `stripe-webhook` and `create-checkout-session` for communicating with Stripe's API.
- `STRIPE_WEBHOOK_SECRET`: Used in `stripe-webhook` to securely verify incoming webhooks from Stripe.
- `STRIPE_PRICE_ID_PRO`: Used in `create-checkout-session`. The exact Stripe Price ID for the "Pro" plan.
- `STRIPE_PRICE_ID_ENTERPRISE`: Used in `create-checkout-session`. The exact Stripe Price ID for the "Enterprise" plan.

#### Resend (Emails)
- `RESEND_API_KEY`: Used in the `send-email` edge function to send transactional emails (organization invites, tryout invites, schedule updates, etc.).

#### OneSignal (Push Notifications)
- `ONESIGNAL_APP_ID`: Used in the `send-push-notification` edge function to identify which app receives the notifications.
- `ONESIGNAL_REST_API_KEY`: Used in the `send-push-notification` edge function to authenticate the request to OneSignal's API.

#### OpenAI (AI Features)
- `OPENAI_API_KEY`: Used in the `generate-ai-insights` edge function to generate AI-powered player summaries and deep dives based on evaluation data.

---

## Third-Party Services Overview
1. **Supabase**: Primary backend—handles the PostgreSQL database, authentication, storage, and edge functions.
2. **Resend**: Handles all transactional email delivery. (Replaced OneSignal for emails due to OneSignal requiring third-party ESPs anyway).
3. **OneSignal**: Handles Push Notifications to iOS/Android devices.
4. **Stripe**: Handles subscription checkouts, payment processing, and billing webhooks.
5. **OpenAI**: Powers the AI insights and player analysis generation.
