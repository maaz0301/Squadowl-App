// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set');
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
        <h2>Organization Invite</h2>
        <p>You have been invited to join an organization on Athlete Assessment as a ${payload?.role ?? 'Member'}.</p>
        <p>Please log in to your account or sign up using this email address to accept the invite.</p>
        <br/>
        <a href="https://athlete-assessment.com/login" style="padding: 10px 20px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 5px;">Login to Athlete Assessment</a>
      `;
    } else if (type === 'tryout_invite') {
      subject = `You have been assigned as an Assessor`;
      html = `
        <h2>Assessment Invite</h2>
        <p>You have been invited to assess players for an upcoming tryout.</p>
        <p>Please log in to your account to view your assignment and score players.</p>
        <br/>
        <a href="https://athlete-assessment.com/login" style="padding: 10px 20px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 5px;">Login to Athlete Assessment</a>
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
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        // For production, change to a verified domain email. 
        // resend.dev can only send to the verified email address associated with the resend account
        from: 'Athlete Assessment <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Resend Error: ${data.message || JSON.stringify(data)}`);
    }

    return new Response(JSON.stringify({ success: true, id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
