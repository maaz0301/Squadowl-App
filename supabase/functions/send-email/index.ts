// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY') || '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') || 'noreply@athleteassessment.com';
const SENDER_NAME = Deno.env.get('SENDER_NAME') || 'Athlete Assessment';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!SENDGRID_API_KEY) {
      throw new Error('SENDGRID_API_KEY is not set');
    }

    const { type, to, payload } = await req.json();

    if (!to || !type) {
      throw new Error('Missing required fields (to, type)');
    }

    let subject = 'Notification from Athlete Assessment';
    let html = '<p>You have a new notification.</p>';

    if (type === 'org_invite') {
      subject = `You have been invited to join an Organization`;
      html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
          <h2 style="color: #111827;">Organization Invite</h2>
          <p>You have been invited to join an organization on Athlete Assessment as a <strong>${payload?.role ?? 'Member'}</strong>.</p>
          <p>Please log in to your account or sign up using this email address to accept the invite.</p>
          ${payload?.password ? `
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; color: #4b5563;">An account was automatically created for you. You can log in using this temporary password:</p>
            <p style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: 1px; color: #111827;">${payload.password}</p>
          </div>
          <p style="font-size: 14px; color: #6b7280;"><em>Note: We highly recommend changing this password after your first login.</em></p>
          ` : ''}
          <br/>
        </div>
      `;
    } else if (type === 'tryout_invite') {
      subject = `You have been assigned as an Assessor`;
      html = `
        <h2>Assessment Invite</h2>
        <p>You have been invited to assess players for an upcoming tryout.</p>
        <p>Please log in to your account to view your assignment and score players.</p>
      `;
    } else if (type === 'schedule_update') {
      subject = `Schedule Update: ${payload?.eventName ?? 'New Event'}`;
      html = `
        <h2>Event Scheduled</h2>
        <p>A new event has been scheduled for your team: <strong>${payload?.eventName ?? 'New Event'}</strong></p>
        ${payload?.date ? `<p>Date: ${payload.date}</p>` : ''}
        ${payload?.time ? `<p>Time: ${payload.time}</p>` : ''}
        ${payload?.location ? `<p>Location: ${payload.location}</p>` : ''}
      `;
    } else if (type === 'reminder') {
      subject = `Reminder: ${payload?.title ?? 'Upcoming Event'}`;
      html = `
        <h2>Reminder</h2>
        <p>${payload?.message ?? 'This is a reminder for an upcoming event or assessment on Athlete Assessment.'}</p>
      `;
    } else if (type === 'registration_confirmation') {
      subject = `Registration Confirmed: ${payload?.playerName}`;
      html = `
        <h2>Registration Confirmed</h2>
        <p>You have successfully registered <strong>${payload?.playerName}</strong>.</p>
        <p>We have received your information and look forward to seeing you at the event.</p>
      `;
    } else if (type === 'password_reset') {
      subject = `Reset your password`;
      html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
          <h2 style="color: #111827; margin-bottom: 20px;">Reset Password</h2>
          <p>We received a request to reset your password. Use the following 6-digit code to proceed:</p>
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #111827;">${payload?.code}</p>
          </div>
          <p style="font-size: 14px; color: #6b7280;">This code will expire shortly. If you did not request this, please ignore this email.</p>
        </div>
      `;
    }

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: to }],
            subject: subject,
          },
        ],
        from: {
          email: SENDER_EMAIL,
          name: SENDER_NAME,
        },
        content: [
          {
            type: 'text/html',
            value: html,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`SendGrid Error: ${res.status} - ${errorText}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Edge Function Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
