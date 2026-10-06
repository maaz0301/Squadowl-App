import { supabaseAdmin } from './supabaseAdmin.ts';

/**
 * Phone push notifications for the emails the app sends.
 *
 * send-email calls `pushForEmail` after an email has gone out. Anyone with the
 * app installed and signed in (so a registered push token) gets the same news
 * in their phone's notification bar; an address with no account or no phone
 * simply gets the email. Best effort: a push problem must never turn a sent
 * email into an error.
 */

export interface PushMessage {
  heading: string;
  content: string;
  data: Record<string, string>;
}

interface EmailEvent {
  title?: string;
  date?: string;
}

const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** "2026-11-03" -> "Nov 3", built without a timezone to shift it. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1] ?? ''} ${d}`.trim();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The push an email type stands for, or null for types that are not worth one. */
// deno-lint-ignore no-explicit-any
export function buildPush(type: string, payload: any): PushMessage | null {
  const team: string = payload?.teamName ?? payload?.seasonName ?? 'your team';

  if (type === 'schedule_digest') {
    const events: EmailEvent[] = (payload?.events ?? []).filter((e: EmailEvent) => isIsoDate(e?.date));
    if (events.length === 0) return null;
    const lines = events.slice(0, 3).map((e) => `${e.title ?? 'Event'} · ${shortDate(e.date as string)}`);
    const more = events.length > 3 ? ` and ${events.length - 3} more` : '';
    return {
      heading: `${events.length} new event${events.length === 1 ? '' : 's'} for ${team}`,
      content: `${lines.join(', ')}${more}`,
      data: { screen: 'calendar', kind: type },
    };
  }

  if (type === 'schedule_update' || type === 'schedule_cancel') {
    const name: string = payload?.eventName ?? 'An event';
    const when = isIsoDate(payload?.date) ? ` · ${shortDate(payload.date)}` : '';
    // The calendar invite's sequence is 0 for a first announcement and counts up
    // with each change, so it tells a new event from a changed one.
    const changed = Number(payload?.sequence ?? 0) > 0;
    return {
      heading:
        type === 'schedule_cancel' ? `Event cancelled: ${name}` : changed ? `Event updated: ${name}` : `New event: ${name}`,
      content: `${team}${when}`,
      data: { screen: 'calendar', kind: type },
    };
  }

  if (type === 'team_manager_invite') {
    return {
      heading: 'Added as a team manager',
      content: `You can now run ${payload?.teamName ?? 'a team'}.`,
      data: { screen: 'teams', kind: type },
    };
  }

  if (type === 'tryout_letter') {
    const subject: string = payload?.subject ?? 'A message from your coaching staff';
    const text = String(payload?.body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return { heading: clip(subject, 120), content: clip(text, 160), data: { screen: 'dashboard', kind: type } };
  }

  if (type === 'reminder') {
    return {
      heading: clip(String(payload?.title ?? 'Upcoming event'), 120),
      content: clip(String(payload?.message ?? ''), 200),
      data: { screen: 'calendar', kind: type },
    };
  }

  return null;
}

/** Escapes LIKE wildcards so an address with `_` or `%` matches only itself. */
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface PushOutcome {
  attempted: boolean;
  /** Phones the push reached. */
  sent?: number;
  /** Why nothing was sent, when that is not an error: no account, no registered phone. */
  note?: string;
  error?: string;
}

/**
 * Pushes the message for this email to the recipient's phones, if they have an
 * account with a registered phone.
 */
export async function pushForEmail(type: string, to: string, payload: unknown): Promise<PushOutcome> {
  try {
    const msg = buildPush(type, payload);
    if (!msg) return { attempted: false };

    // The push function takes account ids (it cannot resolve an email address),
    // so find this person's account first. An address with no account just gets the email.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', likeExact(to.trim()))
      .maybeSingle();
    if (!profile?.id) return { attempted: true, sent: 0, note: 'No account for this address' };

    const { data, error } = await supabaseAdmin.functions.invoke('send-push-notification', {
      body: { target_user_ids: [profile.id], heading: msg.heading, content: msg.content, data: msg.data },
    });
    if (error) {
      // The client's message is just "non-2xx"; the response body says why.
      // deno-lint-ignore no-explicit-any
      const detail = await (error as any).context?.text?.().catch(() => '');
      const message = detail ? `${error.message}: ${String(detail).slice(0, 300)}` : error.message;
      console.error('push failed:', message);
      return { attempted: true, error: message };
    }
    const results = (data?.results ?? []) as { success?: boolean }[];
    if (results.length === 0) return { attempted: true, sent: 0, note: data?.message ?? 'No registered phone' };
    return { attempted: true, sent: results.filter((r) => r.success).length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('push failed:', message);
    return { attempted: true, error: message };
  }
}
