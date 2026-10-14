import { getSupabase } from '@/lib/supabase';

/** Most reports one app session may send, so a crash loop cannot flood the log. */
const MAX_PER_SESSION = 5;
let sent = 0;
const seen = new Set<string>();

/** Sends an uncaught error to the founder dashboard's error alerts. Silent and best effort. */
async function report(message: string, stack?: string) {
  const key = message.slice(0, 200);
  if (sent >= MAX_PER_SESSION || seen.has(key)) return;
  seen.add(key);
  sent += 1;
  try {
    await getSupabase().rpc('report_client_error', {
      p_message: message,
      p_stack: stack ?? null,
      p_url: null,
      p_source: 'app',
      p_user_agent: null,
    });
  } catch {
    // Reporting must never cause an error of its own.
  }
}

/** Chains onto React Native's global handler, so the app still behaves as it did (red box in dev, crash in release). */
export function installErrorReporting() {
  const utils = (globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    const err = error instanceof Error ? error : new Error(String(error));
    void report(`${isFatal ? '[fatal] ' : ''}${err.message}`, err.stack);
    previous(error, isFatal);
  });
}
