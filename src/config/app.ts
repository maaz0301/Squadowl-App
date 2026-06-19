export const APP_CONFIG = {
  /** Switch to 'supabase' when backend is ready */
  dataSource: 'mock' as 'mock' | 'supabase',
  appName: 'AAS Tryout',
  appVersion: '1.0.0',
  syncIntervalMs: 30_000,
  registrationPollMs: 20_000,
} as const;
