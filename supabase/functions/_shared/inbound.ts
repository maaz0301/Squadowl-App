/**
 * Pure helpers for the support-inbound function (SendGrid Inbound Parse).
 * No Deno APIs, so the unit tests can import this file directly.
 */

const EMAIL_RE = /[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+/;

/** "Jo Smith <Jo@Example.com>" -> "jo@example.com". */
export function parseAddress(from: string): string | null {
  const bracketed = from.match(/<([^<>]+)>/);
  const match = (bracketed ? bracketed[1] : from).match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
}

/** The 8-character id our replies carry in their subject: "Re: Help [Ticket 1a2b3c4d]". */
export function extractTicketRef(subject: string): string | null {
  const m = subject.match(/\[Ticket ([0-9a-f]{8})\]/i);
  return m ? m[1].toLowerCase() : null;
}

export function ticketTag(ticketId: string): string {
  return `[Ticket ${ticketId.slice(0, 8)}]`;
}

/** A subject for a new ticket: without our tag. */
export function cleanSubject(subject: string): string {
  return subject.replace(/\s*\[Ticket [0-9a-f]{8}\]/gi, '').trim();
}

/** The Message-ID header out of SendGrid's raw `headers` field. */
export function messageIdFrom(headers: string): string | null {
  const m = headers.match(/^message-id:\s*(<[^>\r\n]+>|\S+)/im);
  return m ? m[1].trim() : null;
}

/** Out-of-office replies, bounces and mailing-list mail: not a person writing in. */
export function isAutomated(headers: string, fromAddress: string): boolean {
  if (/^auto-submitted:\s*(?!no\b)\S/im.test(headers)) return true;
  if (/^precedence:\s*(bulk|junk|auto_reply|list)\b/im.test(headers)) return true;
  if (/^x-auto-?response-suppress:/im.test(headers)) return true;
  if (/^x-autoreply:/im.test(headers)) return true;
  const local = fromAddress.split('@')[0];
  return local === 'mailer-daemon' || local === 'postmaster' || local === 'no-reply' || local === 'noreply';
}

/** HTML-only mail: tags dropped, block breaks kept as line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Just what the person wrote: the quoted thread below "On ... wrote:", an
 * Outlook "-----Original Message-----" block, and ">" quote lines are cut. If
 * that would leave nothing, the whole message is kept.
 */
export function stripQuotedReply(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const cuts = [
    /\n+On [^\n]{0,200}(?:\n[^\n]{0,200})?wrote:\s*(?:\n|$)/i,
    /\n+-{2,}\s*Original Message\s*-{2,}/i,
    /\n+_{5,}\s*\n\s*From:/i,
    /\n+From:\s[^\n]+\n(?:Sent|Date):\s/i,
  ];
  let end = normalized.length;
  for (const re of cuts) {
    const m = re.exec(normalized);
    if (m && m.index < end) end = m.index;
  }
  const kept = normalized
    .slice(0, end)
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join('\n')
    .trim();
  return kept || normalized;
}
