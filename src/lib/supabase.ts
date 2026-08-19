import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { storage } from './storage';
import { APP_CONFIG } from '@/config/app';

/**
 * MMKV-backed storage adapter for Supabase auth session persistence.
 * MMKV is synchronous; the Supabase storage interface accepts sync or async.
 */
const mmkvAuthStorage = {
  getItem: (key: string): string | null => storage.getString(key) ?? null,
  setItem: (key: string, value: string): void => {
    storage.set(key, value);
  },
  removeItem: (key: string): void => {
    storage.remove(key);
  },
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const { supabaseUrl, supabaseAnonKey } = APP_CONFIG;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Supabase not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
      );
    }
    console.log('INIT SUPABASE WITH URL:', JSON.stringify(supabaseUrl));
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: mmkvAuthStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
