// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Stripe Account Links require a real http(s) URL for return_url/refresh_url
// (custom URL schemes like aastryout:// get rejected as "not a valid URL" —
// even in test mode). aas-tryout.app isn't hosted anywhere, so this function's
// own public URL stands in as the return page instead: it's always reachable,
// and it deep-links straight back into the app via the custom scheme that
// InAppBrowser.openAuth() in payments.tsx is watching for.
function page(kind: 'return' | 'refresh'): string {
  const deepLink = `aastryout://payments?connect_${kind}=true`;
  const heading = kind === 'return' ? "You're all set" : 'Almost there';
  const body =
    kind === 'return'
      ? "Stripe has your details. Head back to TryoutHQ to see your connected status."
      : 'Your Stripe session needs a fresh link. Head back to TryoutHQ and tap Connect with Stripe again.';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TryoutHQ</title>
<meta http-equiv="refresh" content="0;url=${deepLink}" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0b0f14; color: #f2f4f7;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { text-align: center; max-width: 360px; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  p { color: #98a2b3; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
  a.button { display: inline-block; background: #ff5a1f; color: white; text-decoration: none;
             font-weight: 600; padding: 12px 20px; border-radius: 10px; }
</style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    <p>${body}</p>
    <a class="button" href="${deepLink}">Return to TryoutHQ</a>
  </div>
</body>
</html>`;
}

serve((req: Request) => {
  const url = new URL(req.url);
  const kind = url.searchParams.has('connect_refresh') ? 'refresh' : 'return';
  return new Response(page(kind), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
