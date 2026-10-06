// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import * as jose from 'npm:jose@5.2.4';

interface PushNotificationPayload {
  target_user_ids: string[];
  heading: string;
  content: string;
  data?: Record<string, any>;
}

// Generate Google API OAuth2 access token for FCM
async function getAccessToken(serviceAccount: any): Promise<string> {
  const jwt = await new jose.SignJWT({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(await jose.importPKCS8(serviceAccount.private_key, 'RS256'));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to get OAuth2 token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
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

    // Load Firebase Service Account key from environment
    const serviceAccountKey = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY');
    if (!serviceAccountKey) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is missing in environment variables');
    }

    const serviceAccount = JSON.parse(serviceAccountKey);
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error('Invalid Firebase service account format');
    }

    // Clean user inputs
    const cleanIds = target_user_ids
      .map(id => id.replace(/"/g, '').trim())
      .filter(Boolean);

    if (cleanIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No valid user IDs or emails provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 1. Resolve profiles by matching either id (UUID) or email
    const listStr = cleanIds.map(id => `"${id}"`).join(',');
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .or(`id.in.(${listStr}),email.in.(${listStr})`);

    if (profilesError) {
      console.error('Error fetching user profiles:', profilesError);
      throw new Error(`Failed to retrieve profiles: ${profilesError.message}`);
    }

    const profileIds = profiles?.map(p => p.id) || [];
    if (profileIds.length === 0) {
      console.log('No user profiles found matching target_user_ids');
      return new Response(
        JSON.stringify({ success: true, message: 'No matching user profiles found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 2. Fetch FCM tokens registered for the resolved profile IDs
    const { data: tokenRecords, error: tokensError } = await supabaseAdmin
      .from('fcm_tokens')
      .select('token')
      .in('user_id', profileIds);

    if (tokensError) {
      console.error('Error fetching FCM tokens:', tokensError);
      throw new Error(`Failed to retrieve FCM tokens: ${tokensError.message}`);
    }

    // One phone is often registered under several accounts (everyone who has signed
    // in on it), so the same token can come back once per account. Send to each
    // phone once, or it shows the same notification several times.
    const tokens = [...new Set(tokenRecords?.map(r => r.token).filter(Boolean) || [])];
    if (tokens.length === 0) {
      console.log('No FCM tokens registered for target users');
      return new Response(
        JSON.stringify({ success: true, message: 'No registered FCM tokens found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 3. Obtain FCM OAuth2 access token
    const accessToken = await getAccessToken(serviceAccount);

    // 4. Send messages to each token in parallel
    const sendPromises = tokens.map(async (token) => {
      // FCM v1 requires data fields to be string format
      const stringifiedData: Record<string, string> = {};
      if (data) {
        for (const [key, val] of Object.entries(data)) {
          stringifiedData[key] = typeof val === 'string' ? val : JSON.stringify(val);
        }
      }

      const fcmPayload = {
        message: {
          token,
          notification: {
            title: heading,
            body: content,
          },
          ...(data ? { data: stringifiedData } : {}),
        },
      };

      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
      const response = await fetch(fcmUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fcmPayload),
      });

      const responseText = await response.text();
      if (!response.ok) {
        console.error(`FCM send error for token ${token}:`, responseText);

        // Auto-cleanup stale/invalid tokens
        try {
          const errJSON = JSON.parse(responseText);
          const errorCode = errJSON?.error?.details?.[0]?.errorCode || errJSON?.error?.status;
          if (errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT') {
            console.log(`FCM token ${token} is unregistered or invalid. Deleting record from database...`);
            await supabaseAdmin
              .from('fcm_tokens')
              .delete()
              .eq('token', token);
          }
        } catch (cleanupErr) {
          console.error('Error during stale token cleanup:', cleanupErr);
        }

        return { success: false, token, error: responseText };
      }

      return { success: true, token, response: JSON.parse(responseText) };
    });

    const results = await Promise.all(sendPromises);
    const sentCount = results.filter(r => r.success).length;
    console.log(`Push notifications delivery finished: ${sentCount}/${tokens.length} sent successfully.`);

    return new Response(
      JSON.stringify({ success: true, results }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in send-push-notification handler:', error);
    
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'An unknown error occurred' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
