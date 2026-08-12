// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { stripe } from '../_shared/stripe.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const rows = list.data.map((e: any) => ({
    id: e.id,
    description: e.description,
    url: e.url,
    status: e.status,
    api_version: e.api_version,
    event_count: e.enabled_events.length,
    created: new Date(e.created * 1000).toISOString(),
  }));
  return new Response(JSON.stringify(rows, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
});
