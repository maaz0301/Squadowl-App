// @ts-ignore: Deno import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { buildIcsCalendar, type IcsEvent } from '../_shared/ics.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

/**
 * A season's whole schedule as a subscribable iCalendar feed.
 *
 * This is the "full season" option behind Add to calendar. A subscribed
 * calendar (Apple, Google, Outlook) re-reads this URL on its own schedule, so
 * an event the coach adds, edits or deletes shows up in every player's,
 * guardian's and coach's calendar without anyone re-sending anything. The
 * single-event .ics copies are snapshots; this is the path that stays in sync.
 *
 * Authorised by the season's own schedule_share_token (the secret in the URL),
 * since calendar apps cannot send a Supabase session. verify_jwt is off for
 * this function in config.toml for that reason. The token only ever exposes
 * what a guardian's schedule link already would: titles, times, locations.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  if (!TOKEN_RE.test(token)) return new Response('Not found', { status: 404 });

  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select('id, name, team_name, archived')
    .eq('schedule_share_token', token)
    .maybeSingle();
  if (!season) return new Response('Not found', { status: 404 });

  const { data: rows, error } = await supabaseAdmin
    .from('season_events')
    .select('id, kind, title, event_date, end_date, start_time, end_time, location, notes, created_at, updated_at')
    .eq('season_id', season.id)
    .order('event_date', { ascending: true });
  if (error) return new Response('Could not load schedule', { status: 500 });

  const teamName = (season.team_name as string | null) || (season.name as string);
  const events: IcsEvent[] = (rows ?? []).map((r: any) => ({
    // Same UID the single-event copies use, so a player who already added one
    // event by hand gets the subscription's version, not a duplicate.
    uid: `season-event-${r.id}@tryouthq.ca`,
    title: `${r.title} (${teamName})`,
    date: r.event_date,
    endDate: r.end_date || undefined,
    startTime: r.start_time || undefined,
    endTime: r.end_time || undefined,
    location: r.location || undefined,
    description: r.notes || undefined,
    sequence: Math.max(
      0,
      Math.floor((Date.parse(r.updated_at) - Date.parse(r.created_at)) / 1000) || 0,
    ),
  }));

  return new Response(buildIcsCalendar(events, `${teamName} schedule`, 'PUBLISH'), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="schedule.ics"',
      'Cache-Control': 'public, max-age=300',
    },
  });
});
