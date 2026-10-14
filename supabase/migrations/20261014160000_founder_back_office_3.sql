-- Founder back office, part 3:
--   support access      a club grants (and revokes) support's right to "View as" its account
--   email outbox        what was sent to whom, so an email a parent never got can be sent again
--   audit actions       new entries for both

alter table public.founder_audit_log drop constraint if exists founder_audit_log_action_check;
alter table public.founder_audit_log add constraint founder_audit_log_action_check check (action = any (array[


  'suspend', 'reactivate', 'create_org', 'update_access', 'impersonate_start', 'impersonate_end',
  'update_user_role', 'reset_password', 'resend_verification', 'ban_user', 'unban_user', 'delete_user',
  'create_announcement', 'end_announcement', 'broadcast_email', 'create_discount_code', 'update_discount_code',
  'refund_payment', 'change_subscription', 'cancel_subscription', 'resume_subscription', 'delete_support_ticket',
  'update_team', 'archive_team', 'unarchive_team', 'update_player', 'add_player_to_team', 'update_team_roster',
  'remove_player_from_team', 'update_season', 'archive_season', 'unarchive_season', 'add_season_event',
  'update_season_event', 'delete_season_event', 'update_tryout', 'archive_tryout', 'unarchive_tryout',
  'delete_tryout', 'restore_tryout', 'add_player_to_tryout', 'update_participant', 'remove_participant',
  'restore_participant', 'update_assessor', 'remove_assessor', 'update_evaluation', 'delete_evaluation',
  'update_platform_blocked_features', 'update_platform_blocked_plan_tiers', 'update_dummy_data_blocked_plan_tiers',
  'update_limits', 'merge_users', 'add_credit', 'set_billing_date',
  'add_club_note', 'delete_club_note', 'update_club_features', 'add_staff', 'remove_staff', 'set_require_mfa',
  'export_person_data', 'erase_athlete', 'erase_family', 'record_consent', 'revoke_consent',
  'update_retention', 'run_retention', 'set_app_version_policy', 'broadcast_custom', 'update_discount_meta',
  'set_max_evaluators', 'update_plan_price',
  'support_access_grant', 'support_access_revoke', 'impersonate_override', 'resend_email'
]::text[]));

-- ---------------------------------------------------------------------------
-- Support access granted by the club
-- ---------------------------------------------------------------------------

alter table public.accounts add column if not exists support_access_until timestamptz;

-- Owners and admins switch it on for a number of days (1 to 30) or off (0).
create or replace function public.set_support_access(p_account_id uuid, p_days int)
returns timestamptz language plpgsql security definer set search_path = public, auth as $$
declare
  v_until timestamptz;
  v_name text;
begin
  if auth.uid() is null or not public.has_account_role(p_account_id, array['owner'::membership_role, 'admin'::membership_role]) then
    raise exception 'Only an owner or admin can change support access' using errcode = '42501';
  end if;
  if p_days is null or p_days < 0 or p_days > 30 then
    raise exception 'Choose between 0 and 30 days' using errcode = '22023';
  end if;
  v_until := case when p_days = 0 then null else now() + make_interval(days => p_days) end;
  update public.accounts set support_access_until = v_until where id = p_account_id returning name into v_name;
  insert into public.founder_audit_log (actor_id, actor_email, action, account_id, account_name, details)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          case when p_days = 0 then 'support_access_revoke' else 'support_access_grant' end,
          p_account_id, v_name, jsonb_build_object('days', p_days, 'until', v_until));
  return v_until;
end;
$$;
grant execute on function public.set_support_access(uuid, int) to authenticated;
revoke execute on function public.set_support_access(uuid, int) from anon, public;

-- Starting a "view as" needs the club's grant, or a written emergency reason that
-- is recorded against the entry. Leaving needs nothing.
drop function if exists public.founder_log_impersonation(uuid, boolean);
create or replace function public.founder_log_impersonation(
  p_account_id uuid, p_started boolean, p_override_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  a public.accounts;
  v_reason text := nullif(trim(coalesce(p_override_reason, '')), '');
  v_granted boolean;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into a from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  if not p_started then
    perform public.founder_write_audit('impersonate_end', p_account_id, a.name, null, '{}'::jsonb);
    return;
  end if;
  v_granted := a.support_access_until is not null and a.support_access_until > now();
  if not v_granted and (v_reason is null or length(v_reason) < 5) then
    raise exception 'This club has not allowed support access. Ask them to switch it on under Organization, or give an emergency reason.'
      using errcode = 'P0001';
  end if;
  perform public.founder_write_audit('impersonate_start', p_account_id, a.name, case when v_granted then null else v_reason end,
    jsonb_build_object('granted_by_club', v_granted));
  if not v_granted then
    perform public.founder_write_audit('impersonate_override', p_account_id, a.name, v_reason, '{}'::jsonb);
  end if;
end;
$$;
grant execute on function public.founder_log_impersonation(uuid, boolean, text) to authenticated;
revoke execute on function public.founder_log_impersonation(uuid, boolean, text) from anon, public;

-- ---------------------------------------------------------------------------
-- Email outbox
-- ---------------------------------------------------------------------------

create table if not exists public.email_outbox (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  to_email   text not null,
  type       text not null,
  subject    text,
  -- What the template needs to be rendered again, with secrets (passwords, codes) removed.
  payload    jsonb not null default '{}'::jsonb,
  resendable boolean not null default true,
  resent_at  timestamptz,
  resent_by  uuid references auth.users(id) on delete set null
);
create index if not exists email_outbox_to_idx on public.email_outbox (lower(to_email), created_at desc);
alter table public.email_outbox enable row level security;
-- No policies: written by send-email and read by founder-support, both with the service role.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('email-outbox-cleanup', '40 3 * * *',
      $job$delete from public.email_outbox where created_at < now() - interval '60 days'$job$);
  end if;
exception when others then
  raise notice 'could not schedule the email outbox cleanup (%)', sqlerrm;
end $$;
