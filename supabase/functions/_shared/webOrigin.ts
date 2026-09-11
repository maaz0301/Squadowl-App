// Stripe Checkout/Billing Portal sessions need a URL to send the browser back
// to once the customer is done. The app has always hardcoded the mobile deep
// link (aastryout://...) here, which is right for the native app but leaves
// web users stranded on Stripe's page — an unregistered custom scheme just
// fails to navigate in a browser, with no way back into the app.
//
// The web client passes its own `origin` so the function can build a proper
// https return URL instead. That value is attacker-controllable (it's a
// client-supplied string), so it's checked against an allow-list rather than
// used as-is — otherwise a crafted request could redirect a real Stripe
// session to an arbitrary domain.
const ALLOWED_WEB_ORIGINS = new Set(
  [
    'https://athlete-assessment-web.vercel.app',
    'https://tryouthq.ca',
    'https://www.tryouthq.ca',
    Deno.env.get('WEB_APP_URL'),
  ].filter((v): v is string => !!v),
);

/** True for http://localhost:<port> or http://127.0.0.1:<port> — local web dev only. */
function isLocalDevOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolves the untrusted `origin` from a request body to a safe web origin,
 * or null if it's missing/not allow-listed (the caller is mobile, or the
 * value didn't match — either way, fall back to the app's own URLs).
 */
export function resolveWebOrigin(origin: unknown): string | null {
  if (typeof origin !== 'string' || !origin) return null;
  if (ALLOWED_WEB_ORIGINS.has(origin) || isLocalDevOrigin(origin)) return origin;
  return null;
}
