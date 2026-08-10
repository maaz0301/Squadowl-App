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

*Note: The **Firebase / FCM configurations** require setting up the following native configuration files:*
- **iOS:** Download `GoogleService-Info.plist` from your Firebase Console project settings (under Bundle ID `com.aastryout`) and add it to the project using Xcode in `ios/AASTryout/`.
- **Android:** Download `google-services.json` from your Firebase Console project settings (under Package Name `com.aastryout`) and save it in `android/app/google-services.json`.

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
- `STRIPE_PRICE_ID_<TIER>_<YEARLY|MONTHLY>`: Used in `create-checkout-session` to look up the exact Stripe Price ID for a given tier + billing interval, e.g. `STRIPE_PRICE_ID_COACH_YEARLY`, `STRIPE_PRICE_ID_COACH_MONTHLY`, `STRIPE_PRICE_ID_COACH_PLUS_YEARLY`, `STRIPE_PRICE_ID_COACH_PLUS_MONTHLY`, `STRIPE_PRICE_ID_CLUB_YEARLY`, `STRIPE_PRICE_ID_CLUB_MONTHLY`. If unset (or empty), the function falls back to creating an ad-hoc Stripe price via `price_data` using the CAD amounts hardcoded in `TIER_PRICES_CAD`, so checkout still works without these being configured — set them once real Stripe Dashboard products/prices exist, to get proper Stripe product analytics/invoicing.
  - Legacy `STRIPE_PRICE_ID_COACH`, `STRIPE_PRICE_ID_CLUB`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_ASSOCIATION` (no interval suffix) are no longer read — the "Pro" and "Association" tiers were retired in favor of "Coach+" (see `src/data/plans.ts`).

#### Resend (Emails)
- `RESEND_API_KEY`: Used in the `send-email` edge function to send transactional emails (organization invites, tryout invites, schedule updates, etc.).

#### Firebase Cloud Messaging (FCM Push Notifications)
- `FIREBASE_SERVICE_ACCOUNT_KEY`: Used in the `send-push-notification` edge function to authenticate calls to the FCM v1 HTTP API. This should be the full JSON string of your Firebase service account private key.
  - **Local Development:** Set this key inside `supabase/.env.local`:
    ```env
    FIREBASE_SERVICE_ACCOUNT_KEY='{"type": "service_account", ...}'
    ```
  - **Production (Supabase):** Set the secret via CLI:
    ```bash
    npx supabase secrets set FIREBASE_SERVICE_ACCOUNT_KEY='{"type": "service_account", ...}'
    ```

#### OpenAI (AI Features)
- `OPENAI_API_KEY`: Used in the `generate-ai-insights` edge function to generate AI-powered player summaries and deep dives based on evaluation data.

---

## Third-Party Services Overview
1. **Supabase**: Primary backend—handles the PostgreSQL database, authentication, storage, and edge functions.
2. **Resend**: Handles all transactional email delivery.
3. **Firebase Cloud Messaging (FCM)**: Handles Push Notifications to iOS/Android devices.
4. **Stripe**: Handles subscription checkouts, payment processing, and billing webhooks.
5. **OpenAI**: Powers the AI insights and player analysis generation.
