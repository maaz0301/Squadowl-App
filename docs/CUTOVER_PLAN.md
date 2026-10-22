# SquadOwl cutover plan and rollback

Old project: `jvkrgejmbuplxznnhspa` (Tryoouthq, ap-southeast-2). New project: `tqsgdizemlclkmsimxdo` (SquadOwl, us-west-2).
Prepared 21 Oct 2026. Status of the new project is in section 1; the cutover itself is section 3.

## 1. State of SquadOwl before cutover

Done and checked:
- Schema identical to old (tables, columns, functions, policies, triggers, indexes, enums, extensions, buckets). Known, intended exceptions: `event_availability.availability_delegate_write` policy is tighter than old, and a few function bodies differ only in formatting.
- Data loaded from the Oct 20 export. 62 of 74 tables match old by content; the rest moved on old after the export.
- 26 edge functions deployed from old's source, same JWT settings. All 38 secrets set (the two Stripe webhook secrets are new values).
- Auth config pushed (site URL, redirects, SendGrid SMTP, rate limits). SMTP login and a test email verified.
- Stored image links rewritten to the new project address.
- Storage: 8 buckets, 58 files, 25 storage policies identical to old. Realtime on `evaluations`, `evaluation_scores`, `season_messages`.
- Rolled-back tests as a coach: row security scopes tryouts and athletes to the account, team create, chat send (`send_season_message`), push-target lookup, storage policy. AI summary function returns a result.

Not done yet (needs a person): Send Email auth hook, email templates, Vercel env vars and redeploy, mobile build, a real sign-in and password reset on the new project, Stripe event deliveries and a test checkout, rolling the secrets that were pasted into chat.

## 2. Before the window

1. Reset the SquadOwl database password. Roll the SendGrid key and both Stripe `whsec_` values; set the new ones on SquadOwl (`supabase secrets set ... --project-ref tqsgdizemlclkmsimxdo`) and the auth SMTP password.
2. Add the Send Email hook (Authentication, Hooks): `https://tqsgdizemlclkmsimxdo.supabase.co/functions/v1/auth-send-email` with `SEND_EMAIL_HOOK_SECRET`. Check the email templates against old.
3. In Stripe, narrow both SquadOwl endpoints to the intended events (platform: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`; connect: `account.updated`, `checkout.session.completed`). Confirm the test-mode versus live-mode situation for the `STRIPE_SECRET_KEY` on SquadOwl.
4. Prepare the web app change on Vercel (Supabase URL and anon key) but do not deploy yet. Prepare the mobile build with the new `.env` and hold it at the store-review stage.
5. Announce a short maintenance window.

## 3. Cutover window

1. Put the web app and apps in maintenance, or announce a quiet period, so nobody writes to the old project.
2. Final delta sync, old to new. Re-run the id comparison and copy rows created on old after the export; remove rows deleted on old. The script used so far is `db-export/sync_delta.py` (it handles one table at a time; identity columns need `overriding system value`). Prefer a fresh full export of the 12 tables that differed if the drift is large.
3. Re-run the row-level compare (`db-export/rowhash.py`). Expect identical tables except the ones with rewritten image links (`accounts`, `athletes`, `profiles`, `athlete_shares`, `teams`).
4. Smoke tests on SquadOwl: sign up and sign in, password reset email, create a team, event and evaluation, set an RSVP, send a chat message and see it arrive live, upload a photo, receive a push, a Stripe test event returns 200, run an AI summary, open the registration link.
5. Switch the web app: set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Vercel to SquadOwl and redeploy.
6. Release the mobile build. Old app versions keep talking to the old project until users update.
7. Take a fresh backup of SquadOwl right after the switch (`pg_dump -Fc -n public -n auth` with the statement timeout off).

## 4. What users notice

- Everyone is signed out once. Sessions are signed with each project's own JWT secret. Passwords still work because the hashes were copied.
- Old mobile app versions point at the old project until updated. Keep the old project running and read-only for as long as old builds are in use. Consider forcing an update.
- Anything written to the old project after the final sync is not on SquadOwl.

## 5. Rollback

The old project is left running and untouched, so rollback is switching back:
1. Point the web app back at the old project (Vercel env vars, redeploy).
2. Release or re-enable the previous mobile build if a new one went out.
3. Re-point the Stripe endpoints if they were moved.

Anything written to SquadOwl after the switch would have to be copied back to old by hand, so keep the window short and decide quickly. After a clean week with no rollback, pause the old project rather than deleting it, and keep its last dump.
