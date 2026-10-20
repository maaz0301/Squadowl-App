import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import {
  cleanSubject,
  extractTicketRef,
  htmlToText,
  isAutomated,
  messageIdFrom,
  parseAddress,
  stripQuotedReply,
} from '../_shared/inbound.ts';

/**
 * Support inbox, inbound side. SendGrid Inbound Parse posts every message sent
 * to support@ here as multipart/form-data; this turns it into a ticket (or a
 * new message on the ticket a reply belongs to) so nobody has to log it by hand.
 *
 * Deploy with --no-verify-jwt: SendGrid can't send a Supabase JWT. The request
 * is authenticated by a shared secret in the URL instead:
 *   https://<project>.supabase.co/functions/v1/support-inbound?token=<SUPPORT_INBOUND_TOKEN>
 *
 * Answers 200 for anything it deliberately drops (automated mail, mail from our
 * own address) so SendGrid doesn't retry it, and 500 only when the database
 * write failed, which SendGrid does retry. The RPC ignores a Message-ID it has
 * already stored, so a retry is safe.
 */

const TOKEN = Deno.env.get('SUPPORT_INBOUND_TOKEN') || '';
const SUPPORT_EMAIL = (Deno.env.get('SUPPORT_FROM_EMAIL') || 'support@tryouthq.ca').toLowerCase();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only.' });
  if (!TOKEN) return reply(500, { error: 'SUPPORT_INBOUND_TOKEN is not set for this function.' });
  const given = new URL(req.url).searchParams.get('token') || '';
  if (!safeEqual(given, TOKEN)) return reply(401, { error: 'Unauthorized.' });

  try {
    const form = await req.formData();
    const field = (k: string) => {
      const v = form.get(k);
      return typeof v === 'string' ? v : '';
    };

    const from = parseAddress(field('from'));
    if (!from) return reply(200, { ignored: 'no sender' });
    if (from === SUPPORT_EMAIL) return reply(200, { ignored: 'our own address' });

    const headers = field('headers');
    if (isAutomated(headers, from)) return reply(200, { ignored: 'automated mail' });

    const subject = field('subject');
    const text = field('text').trim() || htmlToText(field('html'));
    let body = stripQuotedReply(text);
    const attachments = Number(field('attachments')) || 0;
    if (attachments > 0) {
      body += `\n\n[${attachments} attachment${attachments === 1 ? '' : 's'} not stored. Ask the sender to resend if it matters.]`;
    }

    const ref = extractTicketRef(subject);
    const { data, error } = await supabaseAdmin.rpc('support_inbound_message', {
      p_email: from,
      p_subject: cleanSubject(subject),
      p_body: body,
      p_message_id: messageIdFrom(headers),
      p_ticket_ref: ref,
    });
    if (error) {
      console.error('support-inbound: rpc failed', error);
      return reply(500, { error: 'Could not store the message.' });
    }
    return reply(200, { ok: true, ...(data as Record<string, unknown>) });
  } catch (e) {
    console.error('support-inbound: unexpected error', e);
    return reply(500, { error: 'Could not process the message.' });
  }
});
