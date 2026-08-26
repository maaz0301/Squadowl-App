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

/**
 * Backoff for PostgREST's PGRST303 ("JWT issued at future"). PostgREST validates
 * the access token against a cached clock reading; when that reading lags real
 * time by more than its 30s tolerance, a token Auth minted moments ago looks
 * not-yet-valid and the request is refused before it ever reaches the database.
 * It is server-side skew, not a bad token — the same request succeeds once the
 * validator catches up, which is why the *freshest* token is the one that trips
 * it: login signed in fine, then the profile read behind it failed and the raw
 * "JWT issued at future" surfaced under the sign-in form.
 *
 * Jittered rather than fixed delays, because a fixed retry interval rides out
 * ordinary drift but can line up repeatedly with a longer window on one node.
 */
const JWT_SKEW_RETRY_DELAYS_MS = [400, 1200, 2500];

/**
 * True when PostgREST refused the request over the token's `iat` claim. Read off
 * a clone so the caller still gets an unconsumed body, and matched on the error
 * code with the message as a fallback (the code is absent from some gateway
 * responses that still carry the text).
 */
async function isJwtIssuedAtFuture(response: Response): Promise<boolean> {
  if (response.status !== 401 && response.status !== 403) return false;
  try {
    const body = await response.clone().text();
    return body.includes('PGRST303') || /issued at future/i.test(body);
  } catch {
    return false;
  }
}

/**
 * Replays a request PostgREST rejected for clock skew. Safe for every method:
 * a PGRST303 response means JWT validation failed, so nothing was executed.
 * Bodies that can only be read once (uploads) are left alone — Storage doesn't
 * answer with PGRST303 anyway.
 */
const skewTolerantFetch: typeof fetch = async (input, init) => {
  let response = await fetch(input, init);
  const body = init?.body;
  if (body != null && typeof body !== 'string') return response;
  for (const delay of JWT_SKEW_RETRY_DELAYS_MS) {
    if (!(await isJwtIssuedAtFuture(response))) return response;
    console.warn(`Supabase rejected a request with "JWT issued at future"; retrying in ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay + Math.round(Math.random() * 250)));
    response = await fetch(input, init);
  }
  return response;
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
      global: { fetch: skewTolerantFetch },
    });
  }
  return client;
}
