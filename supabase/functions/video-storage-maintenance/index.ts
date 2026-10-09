// Daily video storage housekeeping. Meant to be called once a day by a
// scheduler (see the comment at the bottom for the pg_cron + pg_net setup).
//
//   1. Deletes the stored files of videos that were removed (purge_after set),
//      and of accounts that were deleted (account_video_purge_queue).
//   2. Sends the 7 day and 1 day reminder emails to the account owner while
//      videos are scheduled for deletion.
//   3. On the deletion date, once the account has actually lost its video
//      storage (add-on cancelled, or plan below Coach+), permanently removes
//      every video from storage and sends the confirmation email.
//
// Videos are never deleted because of age. Step 3 only ever acts on an account
// that is no longer entitled, so a late or missing Stripe event can delay a
// deletion but can never cause an early one.
//
// Authorised by the service role key (Authorization: Bearer <service key>) or
// by a shared secret in the VIDEO_MAINTENANCE_SECRET env var, sent as the
// x-maintenance-secret header.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const BUCKET = 'account-videos';
const DAY_MS = 86_400_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });
}

function authorised(req: Request): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const secret = Deno.env.get('VIDEO_MAINTENANCE_SECRET') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (serviceKey && bearer === serviceKey) return true;
  return !!secret && req.headers.get('x-maintenance-secret') === secret;
}

function sizeLabel(bytes: number): string {
  const gb = bytes / 1073741824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Toronto' });
}

/** Removes the objects from storage. Returns false when any removal failed, so the caller keeps the rows. */
async function removeObjects(paths: string[]): Promise<boolean> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) {
      console.error('Storage removal failed:', error.message);
      return false;
    }
  }
  return true;
}

async function sendEmail(to: string | null, type: string, payload: Record<string, unknown>) {
  if (!to) return;
  const { error } = await supabaseAdmin.functions.invoke('send-email', { body: { to, type, payload } });
  if (error) console.error(`Could not send ${type} to ${to}:`, error.message);
}

serve(async (req) => {
  if (!authorised(req)) return json({ error: 'Unauthorized' }, 401);

  const summary = { purgedFiles: 0, remindersSent: 0, accountsCleared: 0, errors: [] as string[] };

  try {
    // 1a. Individually removed videos.
    const { data: removed } = await supabaseAdmin
      .from('account_videos')
      .select('id, storage_path')
      .not('purge_after', 'is', null)
      .lte('purge_after', new Date().toISOString())
      .limit(500);
    if (removed?.length && (await removeObjects(removed.map((r) => r.storage_path)))) {
      await supabaseAdmin.from('account_videos').delete().in('id', removed.map((r) => r.id));
      summary.purgedFiles += removed.length;
    }

    // 1b. Files left behind by deleted accounts.
    const { data: queued } = await supabaseAdmin.from('account_video_purge_queue').select('storage_path').limit(500);
    if (queued?.length && (await removeObjects(queued.map((r) => r.storage_path)))) {
      await supabaseAdmin.from('account_video_purge_queue').delete().in('storage_path', queued.map((r) => r.storage_path));
      summary.purgedFiles += queued.length;
    }

    // 2 + 3. Accounts with videos scheduled for deletion.
    const { data: accounts, error: listError } = await supabaseAdmin.rpc('video_accounts_with_deletion');
    if (listError) throw new Error(listError.message);

    const now = Date.now();
    for (const acct of accounts ?? []) {
      try {
        const deletionAt = new Date(acct.deletion_at).getTime();
        const msLeft = deletionAt - now;

        if (!acct.entitled) {
          // Storage is gone and the paid period is over: delete everything.
          if (msLeft > 0) continue;
          const { data: rows } = await supabaseAdmin
            .from('account_videos')
            .select('id, storage_path')
            .eq('account_id', acct.account_id);
          const paths = (rows ?? []).map((r) => r.storage_path);
          if (paths.length && !(await removeObjects(paths))) {
            summary.errors.push(`remove failed for ${acct.account_id}`);
            continue;
          }
          await supabaseAdmin.from('account_videos').delete().eq('account_id', acct.account_id);
          await supabaseAdmin
            .from('accounts')
            .update({ video_reminder_7_sent_at: null, video_reminder_1_sent_at: null, video_deletion_ack_at: null })
            .eq('id', acct.account_id);
          await sendEmail(acct.owner_email, 'video_deletion_complete', {
            accountName: acct.account_name,
            videoCount: Number(acct.video_count),
          });
          summary.accountsCleared++;
          summary.purgedFiles += paths.length;
          continue;
        }

        // Still entitled until the date: remind.
        if (msLeft <= 0) continue;
        const payload = {
          accountName: acct.account_name,
          deletionDate: dateLabel(acct.deletion_at),
          videoCount: Number(acct.video_count),
          usedLabel: sizeLabel(Number(acct.used_bytes)),
        };
        const nowIso = new Date().toISOString();
        if (msLeft <= DAY_MS && !acct.reminder_1_sent_at) {
          await sendEmail(acct.owner_email, 'video_deletion_reminder', { ...payload, daysLeft: 1 });
          // Anyone this close to the date has missed the 7 day window; do not send it afterwards.
          await supabaseAdmin
            .from('accounts')
            .update({ video_reminder_1_sent_at: nowIso, video_reminder_7_sent_at: acct.reminder_7_sent_at ?? nowIso })
            .eq('id', acct.account_id);
          summary.remindersSent++;
        } else if (msLeft <= 7 * DAY_MS && msLeft > DAY_MS && !acct.reminder_7_sent_at) {
          await sendEmail(acct.owner_email, 'video_deletion_reminder', { ...payload, daysLeft: 7 });
          await supabaseAdmin.from('accounts').update({ video_reminder_7_sent_at: nowIso }).eq('id', acct.account_id);
          summary.remindersSent++;
        }
      } catch (err: any) {
        summary.errors.push(`${acct.account_id}: ${err.message || err}`);
      }
    }
    return json({ ok: true, ...summary });
  } catch (err: any) {
    console.error('video-storage-maintenance failed:', err.message || err);
    return json({ ok: false, error: err.message || String(err), ...summary }, 500);
  }
});

// Scheduling (run once in the SQL editor; needs the pg_cron and pg_net extensions,
// and the function deployed with the secret set via `supabase secrets set
// VIDEO_MAINTENANCE_SECRET=...`). Not applied by any migration on purpose, since the
// project URL and the secret are environment specific:
//
//   select cron.schedule(
//     'video-storage-maintenance', '0 9 * * *',
//     $$ select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/video-storage-maintenance',
//          headers := jsonb_build_object('x-maintenance-secret', '<VIDEO_MAINTENANCE_SECRET>')
//        ) $$
//   );
