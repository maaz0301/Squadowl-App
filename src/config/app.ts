import { EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY } from '@env';

export const APP_CONFIG = {
  appName: 'SquadOwl',
  appVersion: '1.0.0',
  /** Supabase — provided via EXPO_PUBLIC_* env vars (see .env.example) */
  supabaseUrl: (EXPO_PUBLIC_SUPABASE_URL ?? '').trim(),
  supabaseAnonKey: (EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
  /** The web app, for links that have to leave the native app (invites, shares). */
  webUrl: 'https://tryouthq.ca',
} as const;

/**
 * Where an invited assessor is sent to accept. The invite is claimed by email
 * address once an account with that address exists (link_assessor_to_user /
 * handle_new_user), so this URL carries no token and nothing identifying — it
 * only has to land them on the sign-in screen, which explains the rest.
 */
export const ASSESSOR_INVITE_URL = `${APP_CONFIG.webUrl}/login?invite=assessor`;
