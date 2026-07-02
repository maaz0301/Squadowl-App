import { EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY } from '@env';

export const APP_CONFIG = {
  appName: 'AAS Tryout',
  appVersion: '1.0.0',
  syncIntervalMs: 30_000,
  registrationPollMs: 20_000,
  /** Supabase — provided via EXPO_PUBLIC_* env vars (see .env.example) */
  supabaseUrl: EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
} as const;
