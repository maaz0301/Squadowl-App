// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface PushNotificationPayload {
  target_user_ids: string[];
  heading: string;
  content: string;
  data?: Record<string, any>;
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { target_user_ids, heading, content, data } = await req.json() as PushNotificationPayload;

    if (!target_user_ids || target_user_ids.length === 0) {
      throw new Error('target_user_ids is required and must not be empty');
    }

    if (!heading || !content) {
      throw new Error('heading and content are required');
    }

    // @ts-ignore: Deno global
    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
    // @ts-ignore: Deno global
    const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');

    if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
      throw new Error('OneSignal configuration missing in environment variables');
    }

    // Send the notification using OneSignal API
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_aliases: {
          external_id: target_user_ids,
        },
        target_channel: 'push',
        headings: { en: heading },
        contents: { en: content },
        data: data || {},
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OneSignal API error:', errorText);
      throw new Error(`Failed to send push notification: ${response.status} ${response.statusText}`);
    }

    const responseData = await response.json();
    console.log('Push notification sent successfully:', responseData);

    return new Response(
      JSON.stringify({ success: true, data: responseData }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error sending push notification:', error);
    
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'An unknown error occurred' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
