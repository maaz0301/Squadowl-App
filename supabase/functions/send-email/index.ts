// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import nodemailer from 'npm:nodemailer';
import { corsHeaders } from '../_shared/cors.ts';

const SMTP_HOST = Deno.env.get('SMTP_HOST') || 'smtp.gmail.com';
const SMTP_PORT = parseInt(Deno.env.get('SMTP_PORT') || '587');
const SMTP_PASS = Deno.env.get('SMTP_PASS') || '';
const FROM_EMAIL = Deno.env.get('SMTP_FROM_EMAIL') || 'reachraza1@gmail.com';
const FROM_NAME = Deno.env.get('SMTP_FROM_NAME') || 'Athlete Assessment';

// ─── Shared dark-theme HTML wrapper ─────────────────────────────────────────
/** Minimal HTML escaping for user-controlled strings (team/role names) dropped into template markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f0f13;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f13;padding:40px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px 16px 0 0;padding:40px 40px 32px;text-align:center;">
        <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;padding:10px 20px;margin-bottom:18px;">
          <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:1px;">⚡ Athlete Assessment</span>
        </div>
        <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">${title}</h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#1a1a2e;padding:36px 40px;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;">
        ${body}
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#111128;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;border:1px solid #2a2a4a;border-top:none;">
        <p style="margin:0 0 6px;color:#6366f1;font-size:14px;font-weight:600;">Athlete Assessment Platform</p>
        <p style="margin:0;color:#4b5563;font-size:12px;">© ${new Date().getFullYear()} Athlete Assessment. All rights reserved.</p>
        <p style="margin:6px 0 0;color:#374151;font-size:11px;">If you did not expect this email, you can safely ignore it.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

// ─── Templates ───────────────────────────────────────────────────────────────
function tplOrgInvite(role: string, password?: string) {
  const pwBlock = password ? `
    <div style="background:#0f0f13;border:1px solid #6366f1;border-radius:12px;padding:24px;margin:24px 0;text-align:center;">
      <p style="margin:0 0 8px;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Temporary Password</p>
      <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px;color:#a78bfa;font-family:monospace;">${password}</p>
    </div>
    <p style="color:#f59e0b;font-size:13px;margin:0 0 24px;padding:12px 16px;background:#1c1200;border-radius:8px;border-left:3px solid #f59e0b;">
      ⚠️ Please change this password after your first login for security.
    </p>` : '';
  return {
    subject: `You've been invited to join an Organization on Athlete Assessment`,
    html: wrap("You're Invited! 🎉", `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;">
        You've been invited to join an organization on <strong style="color:#a78bfa;">Athlete Assessment</strong> as a
        <span style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:2px 14px;border-radius:20px;font-size:14px;font-weight:600;">${role}</span>.
      </p>
      ${pwBlock}
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 8px;">
        Log in (or sign up with this email) to accept the invite and get started.
      </p>
    `),
  };
}

function tplTeamManagerInvite(teamName: string, role: string, password?: string) {
  const safeTeam = escapeHtml(teamName);
  const roleLabel = role === 'coach' ? 'Coach' : 'Manager';
  const pwBlock = password ? `
    <div style="background:#0f0f13;border:1px solid #6366f1;border-radius:12px;padding:24px;margin:24px 0;text-align:center;">
      <p style="margin:0 0 8px;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Temporary Password</p>
      <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px;color:#a78bfa;font-family:monospace;">${password}</p>
    </div>
    <p style="color:#f59e0b;font-size:13px;margin:0 0 24px;padding:12px 16px;background:#1c1200;border-radius:8px;border-left:3px solid #f59e0b;">
      ⚠️ Please change this password after your first login for security.
    </p>` : '';
  return {
    subject: `You've been added to ${safeTeam} on Athlete Assessment`,
    html: wrap("You've Been Added to a Team! 🏒", `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;">
        You've been given access to manage <strong style="color:#a78bfa;">${safeTeam}</strong> on
        <strong style="color:#a78bfa;">Athlete Assessment</strong> as its
        <span style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:2px 14px;border-radius:20px;font-size:14px;font-weight:600;">${roleLabel}</span>.
      </p>
      ${pwBlock}
      <div style="background:#0f0f13;border-radius:12px;padding:20px 24px;margin:20px 0;border-left:4px solid #6366f1;">
        <p style="color:#9ca3af;font-size:13px;margin:0 0 4px;">What you can do</p>
        <p style="color:#fff;font-size:15px;line-height:1.6;margin:0;">
          View and manage this team's roster, schedule, chat, and assessments — no access to anything else on the club's account.
        </p>
      </div>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0;">
        Log in (or sign up with this email) to get started.
      </p>
    `),
  };
}

function tplTryoutInvite(tryoutName?: string) {
  return {
    subject: `You've been assigned as an Assessor`,
    html: wrap('Assessor Assignment 📋', `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;">
        You've been assigned to assess players for an upcoming tryout${tryoutName ? ` — <strong style="color:#a78bfa;">${tryoutName}</strong>` : ''}.
      </p>
      <div style="background:#0f0f13;border-radius:12px;padding:20px 24px;margin:20px 0;border-left:4px solid #6366f1;">
        <p style="color:#9ca3af;font-size:13px;margin:0 0 4px;">Your role</p>
        <p style="color:#fff;font-size:17px;font-weight:600;margin:0;">⚡ Assessor</p>
      </div>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0;">
        Log in to view player rosters, submit scores, and complete evaluations.
      </p>
    `),
  };
}

function tplScheduleUpdate(eventName: string, date?: string, time?: string, location?: string) {
  const rows = [
    date ? `<tr><td style="color:#9ca3af;padding:8px 0 8px;font-size:14px;width:100px;">📅 Date</td><td style="color:#fff;font-weight:600;padding:8px 0;font-size:14px;">${date}</td></tr>` : '',
    time ? `<tr><td style="color:#9ca3af;padding:8px 0;font-size:14px;">🕐 Time</td><td style="color:#fff;font-weight:600;padding:8px 0;font-size:14px;">${time}</td></tr>` : '',
    location ? `<tr><td style="color:#9ca3af;padding:8px 0;font-size:14px;">📍 Location</td><td style="color:#fff;font-weight:600;padding:8px 0;font-size:14px;">${location}</td></tr>` : '',
  ].join('');
  return {
    subject: `Schedule Update: ${eventName}`,
    html: wrap('New Event Scheduled 📅', `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;">A new event has been added to your schedule:</p>
      <div style="background:#0f0f13;border-radius:12px;padding:24px;margin:16px 0;border:1px solid #2a2a4a;">
        <p style="color:#a78bfa;font-size:20px;font-weight:700;margin:0 0 16px;">${eventName}</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </div>

    `),
  };
}

function tplReminder(title: string, message: string) {
  return {
    subject: `Reminder: ${title}`,
    html: wrap(`⏰ ${title}`, `
      <div style="background:linear-gradient(135deg,#1c1200,#1a1a2e);border-radius:12px;padding:24px;margin-bottom:24px;border-left:4px solid #f59e0b;">
        <p style="color:#fbbf24;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;font-weight:600;">Reminder</p>
        <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0;">${message}</p>
      </div>
    `),
  };
}

function tplRegistrationConfirm(playerName: string) {
  return {
    subject: `Registration Confirmed: ${playerName}`,
    html: wrap('Registration Confirmed ✓', `
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#065f46,#059669);border-radius:50%;width:64px;height:64px;font-size:30px;">✓</div>
      </div>
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;text-align:center;">
        <strong style="color:#34d399;">${playerName}</strong> has been successfully registered!
      </p>
      <div style="background:#0f0f13;border-radius:12px;padding:20px 24px;margin:16px 0;border-left:4px solid #34d399;">
        <p style="color:#9ca3af;font-size:13px;margin:0 0 4px;">Registered Athlete</p>
        <p style="color:#fff;font-size:18px;font-weight:700;margin:0;">${playerName}</p>
      </div>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:20px 0 0;">
        We've received all information and look forward to seeing them at the event. You'll be notified of any updates.
      </p>
    `),
  };
}

function tplPasswordReset(code: string) {
  return {
    subject: `Reset Your Password — Athlete Assessment`,
    html: wrap('Reset Your Password 🔐', `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 24px;">
        We received a request to reset your password. Use the verification code below — it expires shortly.
      </p>
      <div style="background:#0f0f13;border:1px solid #6366f1;border-radius:16px;padding:32px;margin:24px 0;text-align:center;">
        <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;font-weight:600;">Verification Code</p>
        <p style="margin:0;font-size:44px;font-weight:700;letter-spacing:10px;color:#a78bfa;font-family:monospace;">${code}</p>
      </div>
      <p style="color:#ef4444;font-size:13px;margin:0;padding:12px 16px;background:#1c0505;border-radius:8px;border-left:3px solid #ef4444;">
        🔒 If you did not request this reset, please ignore this email — your account remains secure.
      </p>
    `),
  };
}

function tplSubscriptionUpgraded(planTier: string) {
  const planName = planTier.charAt(0).toUpperCase() + planTier.slice(1);
  return {
    subject: `Welcome to ${planName} — Athlete Assessment`,
    html: wrap('Subscription Upgraded 🚀', `
      <div style="background:#0f0f13;border:1px solid #10b981;border-radius:16px;padding:24px;margin-bottom:32px;text-align:center;">
        <p style="margin:0;color:#10b981;font-size:18px;font-weight:700;">✅ Successfully Upgraded to ${planName}</p>
      </div>
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 24px;">
        Thank you for upgrading! Your account has been instantly unlocked with all the premium features of the <strong>${planName}</strong> plan.
      </p>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 24px;">
        You can now return to the app and start using your new features immediately. If you have any questions or need help setting up your new tools, our support team is always here for you.
      </p>
    `),
  };
}

function tplSubscriptionCanceled() {
  return {
    subject: `Subscription Canceled — Athlete Assessment`,
    html: wrap('Subscription Canceled 😔', `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 24px;">
        We've successfully processed your subscription cancellation. Your account has been downgraded to the Free plan.
      </p>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 24px;">
        You will no longer be billed, but you can continue using all the features of the Free plan. If you ever change your mind, we'd love to have you back on a premium plan!
      </p>
      <div style="background:#1c0505;border-left:4px solid #ef4444;border-radius:0 8px 8px 0;padding:16px 20px;margin-top:12px;">
        <p style="color:#fca5a5;font-size:13px;line-height:1.5;margin:0;">
          If you did not request this cancellation, please contact our support team immediately to restore your account.
        </p>
      </div>
    `),
  };
}

// ─── Main handler ────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { type, to, payload } = await req.json();

    if (!to || !type) throw new Error('Missing required fields (to, type)');

    let subject = 'Notification from Athlete Assessment';
    let html = '<p>You have a new notification.</p>';

    if (type === 'org_invite') ({ subject, html } = tplOrgInvite(payload?.role ?? 'Member', payload?.password));
    else if (type === 'team_manager_invite') ({ subject, html } = tplTeamManagerInvite(payload?.teamName ?? 'a team', payload?.role ?? 'manager', payload?.password));
    else if (type === 'tryout_invite') ({ subject, html } = tplTryoutInvite(payload?.tryoutName));
    else if (type === 'schedule_update') ({ subject, html } = tplScheduleUpdate(payload?.eventName ?? 'New Event', payload?.date, payload?.time, payload?.location));
    else if (type === 'reminder') ({ subject, html } = tplReminder(payload?.title ?? 'Upcoming Event', payload?.message ?? 'This is a reminder for an upcoming event.'));
    else if (type === 'registration_confirmation') ({ subject, html } = tplRegistrationConfirm(payload?.playerName ?? 'Athlete'));
    else if (type === 'password_reset') ({ subject, html } = tplPasswordReset(payload?.code ?? '------'));
    else if (type === 'subscription_upgraded') ({ subject, html } = tplSubscriptionUpgraded(payload?.planTier ?? 'Pro'));
    else if (type === 'subscription_canceled') ({ subject, html } = tplSubscriptionCanceled());

    // Send via Gmail SMTP using nodemailer
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: FROM_EMAIL,
        pass: SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      text: 'Please view this in an HTML email client.',
      html,
    });

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
