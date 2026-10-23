// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Stripe Account Links require a real http(s) URL for return_url/refresh_url
// (custom URL schemes like aastryout:// get rejected as "not a valid URL" —
// even in test mode). aas-tryout.app isn't hosted anywhere, so this function's
// own public URL stands in as the return page instead: it's always reachable,
// and it deep-links straight back into the app via the custom scheme that
// InAppBrowser.openAuth() in payments.tsx is watching for.
// Supabase serves a function's HTML as text/plain, so the old page (and its
// meta refresh) showed up as raw markup and never redirected. A real 302 does
// work, and is what the in-app browser session is watching for.
// Phones go back into the app through its deep link. A desktop browser has no app
// registered for aastryout://, so the redirect would leave it stuck on a blank
// page: send it to the website's Payments page instead.
const WEB_URL = (Deno.env.get('WEB_APP_URL') ?? 'https://www.tryouthq.ca').replace(/\/$/, '');

serve((req: Request) => {
  const url = new URL(req.url);
  const kind = url.searchParams.has('connect_refresh') ? 'refresh' : 'return';
  const isPhone = /iPhone|iPad|iPod|Android/i.test(req.headers.get('user-agent') ?? '');
  const location = isPhone
    ? `aastryout://payments?connect_${kind}=true`
    : `${WEB_URL}/payments?connect_${kind}=true`;
  return new Response(null, { status: 302, headers: { Location: location } });
});
