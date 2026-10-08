# Moving the SquadOwl backend to the new environment

Prepared 8 Oct 2026. Nothing in this document has been run: every number below was read from the live
project (`jvkrgejmbuplxznnhspa`, "Tryoouthq") with read-only queries, and every step is a plan.

## 1. Recommendation

**Do not rebuild the new database by replaying the migration files.** Copy the live database instead.

Pick the method by what "new environment" means:

| If the goal is... | Use | Why |
|---|---|---|
| Hand the project to the client's own Supabase organization | **Transfer project** (Supabase dashboard, Project Settings, General) | Same project, same URL, same keys, same data. No dump, no app rebuild, no downtime. This is by far the safest option, so check it first. |
| A separate new project (new region, new account that cannot receive a transfer, staging copy) | **Dump and restore** (section 5) | Exact copy of what is live today, about 656 MB, so the copy itself takes minutes. |
| A copy inside the same organization | Dashboard backups, "Restore to a new project" | Only if the plan includes backups. Same organization only. |

If the new environment is just "the client's account", ask which of the first two applies before doing anything.
The Stripe move in `stripe.md` suggests the client's own accounts are the aim, which points to the transfer.

## 2. What is in the live project (verified)

| Item | Value |
|---|---|
| Database | Postgres 17.6, **656 MB** |
| Region | ap-southeast-2 (Sydney) |
| Tables / functions / policies / triggers | 63 / 219 / 112 (+23 on storage) / 29 in `public` |
| Auth | **41,106 users**, all email and password (no social logins). Auth trigger `on_auth_user_created`. |
| Biggest tables | `evaluation_scores` 974k rows, `evaluations` 441k, `tryout_participants` 186k, `athletes` 181k, `season_roster` 118k |
| Extensions | citext, pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault (all standard). No `pg_cron`, so no scheduled jobs. |
| Realtime | Three tables: `evaluation_scores`, `evaluations`, `season_messages` |
| Storage | 7 buckets, about **41 MB** in ~50 files (`avatars` is public; the rest are private) |
| Edge functions | **24 deployed** (17 from this repo, 8 from the web repo; `send-email` exists in both) |
| Stored links to this project | 21 rows (`accounts.logo_url`, `athletes.avatar_url`, `profiles.avatar_url`, `athlete_shares.coach_avatar_url`) |

Note that 41,106 users is large for the amount of real use. If much of it is generated test data
(`generate-test-players`), moving only real data would be faster and cleaner. Decide this before the dump.

## 3. Why not replay the migrations

- The migration history on the server does not match the files: dozens of versions exist on one side only
  (`supabase migration list` shows many local-only and remote-only entries). `supabase db push` could try to
  re-run old migrations against a database that already has them.
- Migrations live in **two repos**: 124 here, 59 in the web repo. 32 have the same name, **one differs**
  (`20260928120000_find_coach_by_email.sql`), and 27 exist only in the web repo.
- Several migrations changed the database by hand later, so the files are not a complete description of it.

A dump of the live database is the only source that is correct by definition.

## 4. Access and setup needed

1. **Owner or admin access** on the old project and on the new organization (to create or receive a project).
2. **The new project**, created first, in the region you want, on a plan that fits (Pro or higher; 656 MB
   plus 41k users is beyond what a free project handles comfortably). Use the same Postgres major version (17).
3. **Database connection strings** for both projects (Settings, Database; use the direct or session pooler string
   for dump and restore, not the transaction pooler). Database passwords are needed, and the CLI cannot show them.
4. **Tools** on the machine doing the move: Supabase CLI, `psql` and `pg_dump` for Postgres 17, Deno (for function
   deploys), and enough disk for about 2 GB of working files.
5. **Every secret value**, from their original sources (the CLI lists names only). Names needed, from the code:
   `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`,
   the `STRIPE_PRICE_ID_*` set, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`,
   `SEND_EMAIL_HOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `SUPPORT_FROM_EMAIL`, `EMAIL_LOGO_URL`,
   `APP_BASE_URL`, `WEB_APP_URL`, `PUBLIC_SITE_URL`. See `KEYS_IN_USE.md` for what reads what.
6. **Admin access to the outside services** that point at the project: Stripe (webhook endpoints), Firebase
   (push), SendGrid, the web host (Vercel) for environment variables, and Apple and Google store consoles.

## 5. Runbook (dump and restore)

Do the whole thing once as a rehearsal into the new project before the real cutover, because the rehearsal
shows exactly how long it takes and what breaks.

### A. Prepare
1. Create the new project. Note its URL, `anon` key, `service_role` key and database URL.
2. Decide what to bring (all users, or only real data) and tell users about the maintenance window.

### B. Freeze and dump (the cutover window)
1. Stop writes: put the web app and the apps into a maintenance state, or at least announce a quiet window.
2. Dump the live database:
   ```bash
   supabase db dump --db-url "$OLD_DB_URL" -f roles.sql  --role-only
   supabase db dump --db-url "$OLD_DB_URL" -f schema.sql
   supabase db dump --db-url "$OLD_DB_URL" -f data.sql   --use-copy --data-only
   ```
3. Keep these files private: `data.sql` contains every user's data and password hashes.

### C. Restore
```bash
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' --file data.sql \
  --dbname "$NEW_DB_URL"
```
`session_replication_role = replica` stops triggers firing during the load. Without it,
`on_auth_user_created` would try to create 41k profiles that the data already contains.

### D. Check the restore before going further
Compare these against the old project (they were read from it today). Any mismatch must be fixed first.
- Row counts of the biggest tables, and `auth.users` = 41,106.
- 63 tables in `public`, 219 functions, 112 policies in `public`, 29 triggers in `public`.
- The `on_auth_user_created` trigger on `auth.users` exists. **Dumps often leave out triggers and policies on
  Supabase-owned schemas.** If it is missing, recreate it from the migration that defined it.
- The 23 policies on `storage.objects` exist (same caveat).
- The `supabase_realtime` publication contains the three tables above.
- The 7 storage buckets exist with the same public or private setting.

### E. Storage files
The dump holds only the file records, not the files. Copy the ~50 files with a short script using the
service-role key, or the Storage S3 endpoint (list each bucket on the old project, download, upload to the
same path on the new one). Then rewrite the 21 stored links:
```sql
update public.accounts set logo_url = replace(logo_url, 'OLDREF.supabase.co', 'NEWREF.supabase.co') where logo_url like '%OLDREF.supabase.co%';
-- repeat for athletes.avatar_url, profiles.avatar_url, athlete_shares.coach_avatar_url
```

### F. Edge functions
1. Resolve `send-email`: the two repos hold different versions (811 and 805 lines). Download the live one with
   `supabase functions download send-email`, compare, and deploy that, then fix the repos so only one owns it.
2. Deploy from both repos with `--project-ref NEWREF`:
   - The app repo's `supabase/config.toml` carries the `verify_jwt = false` settings for its webhooks.
   - **The web repo has no config file.** These must be deployed with `--no-verify-jwt`, matching production:
     `auth-send-email`, `request-password-reset`, plus `send-email`. Wrong settings here either break the auth
     email hook or leave a function open to anyone.
3. Set all secrets (section 4, item 5) on the new project.

### G. Auth settings
These are not in the database dump. Push them from `supabase/config.toml` with `supabase config push`, then check
by hand: site URL, the redirect URL list (including `aastryout://**`), the email hook pointing at the new
`auth-send-email` URL with the new `SEND_EMAIL_HOOK_SECRET`, SMTP or SendGrid, email templates, password rules,
and rate limits.

### H. Outside services
- **Stripe:** register new webhook endpoints (`.../functions/v1/stripe-webhook` and `.../stripe-connect-webhook`)
  on the new project address, and set the new signing secrets. `stripe.md` has the steps.
- **Firebase:** the push key is a secret, so it carries over; check a test push arrives.
- **Web host:** set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` and redeploy.
- **Mobile apps:** set `EXPO_PUBLIC_SUPABASE_URL` and the key, build, and release to both stores.

### I. Cutover and rollback
1. Verify with the checklist in section 6 against the new project.
2. Switch the web app over. Leave the **old project running and untouched** as the rollback.
3. Rollback is just pointing the web app back, as long as nothing was written to the new project; any
   data written after cutover would have to be copied back, so keep the window short.

## 6. What users will notice

- **Everyone is signed out once.** Sign-in sessions are signed with the project's JWT secret, which differs
  on a new project. Passwords still work, because the password hashes come across in `auth.users`.
- **Old app versions break.** The mobile apps have the old project address built in. Anyone who has not
  updated keeps talking to the old project. Keep the old project alive and read-only until most users have
  updated, and consider forcing an update. (A Supabase custom domain, used from the start, avoids this next time.)
- **Links to old stored images** keep working only while the old project exists, unless rewritten (step E).

## 7. Final checks on the new project

Sign up and sign in; reset a password email; create a team, event and evaluation; set an RSVP; send a chat message
and see it arrive live; upload a photo; receive a push; make a test Stripe payment and see the webhook land; run an
AI summary; open the registration link and QR; delete a throwaway account.

## 8. Open questions for the client

1. Is the new environment the client's own Supabase organization (transfer) or a separate new project (dump)?
2. Should all 41,106 users move, or only real ones?
3. Which region, and which plan?
4. How long a maintenance window is acceptable, and are old app versions allowed to stop working?
5. Who will hold the Stripe, Firebase, SendGrid and store accounts afterwards?

## 9. Effort

About half a day for the rehearsal (dump, restore, checks), plus the same again for the cutover once the
window is agreed. Add time for store review if a new mobile build has to go out. If a project transfer is
possible, most of this disappears.
