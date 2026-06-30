export const APP_CONFIG = {
  /** Switch to 'supabase' when backend is ready */
  dataSource: 'supabase' as 'mock' | 'supabase',
  appName: 'AAS Tryout',
  appVersion: '1.0.0',
  syncIntervalMs: 30_000,
  registrationPollMs: 20_000,
  /** Supabase — provided via EXPO_PUBLIC_* env vars (see .env.example) */
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
} as const;
