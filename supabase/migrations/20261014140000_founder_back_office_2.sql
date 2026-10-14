-- Founder back office, part 2:
--   evaluator limit      accounts.max_evaluators, enforced when an assessor is invited
--   error alerts         client_error_log + report_client_error() + founder_error_summary()
--   plan pricing         plan_prices (new Stripe prices the checkout and webhook honour)
--   revenue per code     discount_code_redemptions.amount_paid_cents
--   support club view    founder_org_summary(): read-only, for the support role
--   retention            already scheduled by part 1 (pg_cron is installed)

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
  'set_max_evaluators', 'update_plan_price'
]::text[]));

-- ---------------------------------------------------------------------------
-- Evaluator limit
-- ---------------------------------------------------------------------------

alter table public.accounts add column if not exists max_evaluators int;
alter table public.accounts drop constraint if exists accounts_max_evaluators_valid;
alter table public.accounts add constraint accounts_max_evaluators_valid
  check (max_evaluators is null or max_evaluators between 0 and 10000);

-- Distinct people invited to evaluate anything the organization runs.
create or replace function public.account_evaluator_count(p_account_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct coalesce(ta.user_id::text, lower(ta.email::text)))::int
    from public.tryout_assessors ta
    join public.tryouts t on t.id = ta.tryout_id
   where t.account_id = p_account_id
     and t.deleted_at is null
     and coalesce(ta.user_id::text, ta.email::text) is not null;
$$;
revoke all on function public.account_evaluator_count(uuid) from public, anon, authenticated;

create or replace function public.enforce_max_evaluators()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_account uuid;
  v_max int;
  v_identity text := coalesce(new.user_id::text, lower(new.email::text));
begin
  if v_identity is null then
    return new;
  end if;
  select a.id, a.max_evaluators into v_account, v_max
    from public.tryouts t join public.accounts a on a.id = t.account_id
   where t.id = new.tryout_id;
  if v_max is null then
    return new;
  end if;
  -- Someone already counted can be added to another evaluation.
  if exists (
    select 1 from public.tryout_assessors ta join public.tryouts t on t.id = ta.tryout_id
     where t.account_id = v_account and t.deleted_at is null
       and coalesce(ta.user_id::text, lower(ta.email::text)) = v_identity
  ) then
    return new;
  end if;
  if public.account_evaluator_count(v_account) >= v_max then
    raise exception 'This organization has reached its limit of % evaluators. Contact support to raise it.', v_max
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists tryout_assessors_max_evaluators on public.tryout_assessors;
create trigger tryout_assessors_max_evaluators
  before insert on public.tryout_assessors
  for each row execute function public.enforce_max_evaluators();

create or replace function public.founder_get_org_limits(p_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return (select jsonb_build_object('maxEvaluators', a.max_evaluators,
                                    'evaluatorCount', public.account_evaluator_count(a.id))
            from public.accounts a where a.id = p_account_id);
end;
$$;

create or replace function public.founder_set_max_evaluators(p_account_id uuid, p_max int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_before int;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select name, max_evaluators into v_name, v_before from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  update public.accounts set max_evaluators = p_max where id = p_account_id;
  perform public.founder_write_audit('set_max_evaluators', p_account_id, v_name, null,
    jsonb_build_object('before', v_before, 'after', p_max));
  return public.founder_get_org_limits(p_account_id);
end;
$$;
grant execute on function public.founder_get_org_limits(uuid) to authenticated;
grant execute on function public.founder_set_max_evaluators(uuid, int) to authenticated;
revoke execute on function public.founder_get_org_limits(uuid) from anon, public;
revoke execute on function public.founder_set_max_evaluators(uuid, int) from anon, public;

-- ---------------------------------------------------------------------------
-- Error alerts
-- ---------------------------------------------------------------------------

create table if not exists public.client_error_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid,
  source      text not null default 'web' check (source in ('web', 'app')),
  message     text not null,
  stack       text,
  url         text,
  user_agent  text,
  fingerprint text not null
);
create index if not exists client_error_log_created_idx on public.client_error_log (created_at desc);
create index if not exists client_error_log_fp_idx on public.client_error_log (fingerprint, created_at desc);
alter table public.client_error_log enable row level security;

-- Any client may report; abuse is bounded by a global per-minute cap and a
-- per-fingerprint repeat window, and nothing readable comes back.
create or replace function public.report_client_error(
  p_message text, p_stack text default null, p_url text default null,
  p_source text default 'web', p_user_agent text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_fp text;
begin
  if coalesce(trim(p_message), '') = '' then
    return;
  end if;
  v_fp := md5(left(p_message, 300) || coalesce(left(p_stack, 200), ''));
  if (select count(*) from public.client_error_log where created_at > now() - interval '1 minute') >= 100 then
    return;
  end if;
  if exists (select 1 from public.client_error_log
              where fingerprint = v_fp and coalesce(user_id::text, '') = coalesce(auth.uid()::text, '')
                and created_at > now() - interval '10 minutes') then
    return;
  end if;
  insert into public.client_error_log (user_id, source, message, stack, url, user_agent, fingerprint)
  values (auth.uid(), case when p_source = 'app' then 'app' else 'web' end,
          left(p_message, 500), left(p_stack, 4000), left(p_url, 500), left(p_user_agent, 300), v_fp);
end;
$$;
grant execute on function public.report_client_error(text, text, text, text, text) to anon, authenticated;

create or replace function public.founder_error_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'last24h', (select count(*) from public.client_error_log where created_at > now() - interval '24 hours'),
    'last7d',  (select count(*) from public.client_error_log where created_at > now() - interval '7 days'),
    'usersAffected24h', (select count(distinct user_id) from public.client_error_log where created_at > now() - interval '24 hours'),
    'trialsEnding7d', (select count(*) from public.accounts a
                        where not a.hidden_from_founder and a.suspended_at is null and not a.is_comp
                          and a.stripe_subscription_id is null
                          and a.trial_ends_at between now() and now() + interval '7 days'),
    'top', coalesce((
      select jsonb_agg(x order by (x->>'count')::int desc) from (
        select jsonb_build_object('message', min(message), 'source', min(source), 'count', count(*)::int,
                                  'lastAt', max(created_at), 'url', min(url)) as x
          from public.client_error_log
         where created_at > now() - interval '7 days'
         group by fingerprint
         order by count(*) desc
         limit 8) s), '[]'::jsonb));
end;
$$;
grant execute on function public.founder_error_summary() to authenticated;
revoke execute on function public.founder_error_summary() from anon, public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('client-error-log-cleanup', '30 3 * * *',
      $job$delete from public.client_error_log where created_at < now() - interval '30 days'$job$);
  end if;
exception when others then
  raise notice 'could not schedule the error log cleanup (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Plan pricing (new Stripe prices created from the console)
-- ---------------------------------------------------------------------------

create table if not exists public.plan_prices (
  tier            text not null check (tier in ('coach', 'coach_plus', 'club')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  amount_cents    int not null check (amount_cents between 100 and 10000000),
  stripe_price_id text not null,
  updated_at      timestamptz not null default now(),
  primary key (tier, billing_interval)
);
alter table public.plan_prices enable row level security;
-- No policies: written by the founder-billing function (service role), read through the functions below.

create or replace function public.plan_price_overrides()
returns table (tier text, billing_interval text, amount_cents int)
language sql stable security definer set search_path = public as $$
  select p.tier, p.billing_interval, p.amount_cents from public.plan_prices p;
$$;
grant execute on function public.plan_price_overrides() to authenticated, anon;

create or replace function public.founder_plan_prices()
returns table (tier text, billing_interval text, amount_cents int, stripe_price_id text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query select p.tier, p.billing_interval, p.amount_cents, p.stripe_price_id, p.updated_at from public.plan_prices p;
end;
$$;
grant execute on function public.founder_plan_prices() to authenticated;
revoke execute on function public.founder_plan_prices() from anon, public;

-- ---------------------------------------------------------------------------
-- Revenue per discount code
-- ---------------------------------------------------------------------------

alter table public.discount_code_redemptions add column if not exists amount_paid_cents int;

create or replace function public.founder_discount_revenue()
returns table (code_id uuid, revenue_cents bigint, paid_redemptions bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select r.code_id, coalesce(sum(r.amount_paid_cents), 0)::bigint, count(r.amount_paid_cents)
      from public.discount_code_redemptions r group by r.code_id;
end;
$$;
grant execute on function public.founder_discount_revenue() to authenticated;
revoke execute on function public.founder_discount_revenue() from anon, public;

-- ---------------------------------------------------------------------------
-- Support role: a read-only look at a club
-- ---------------------------------------------------------------------------

create or replace function public.founder_org_summary(p_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare a public.accounts;
begin
  if not public.is_founder_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into a from public.accounts where id = p_account_id and not hidden_from_founder;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', a.id, 'name', a.name, 'planTier', a.plan_tier::text,
    'accessStatus', public.account_access_status(a), 'subscriptionStatus', a.subscription_status::text,
    'trialEndsAt', a.trial_ends_at, 'suspendedAt', a.suspended_at, 'suspendedReason', a.suspended_reason,
    'createdAt', a.created_at,
    'members', coalesce((select jsonb_agg(jsonb_build_object('email', p.email, 'name', p.display_name,
                                                              'role', m.role::text, 'lastSignIn', u.last_sign_in_at)
                                           order by m.role::text, p.email)
                           from public.memberships m join public.profiles p on p.id = m.user_id
                           left join auth.users u on u.id = m.user_id
                          where m.account_id = a.id), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'archived', t.archived) order by t.name)
                         from public.teams t where t.account_id = a.id), '[]'::jsonb),
    'evaluationCount', (select count(*) from public.tryouts t where t.account_id = a.id and t.deleted_at is null),
    'seasonCount', (select count(*) from public.seasons s where s.account_id = a.id));
end;
$$;
grant execute on function public.founder_org_summary(uuid) to authenticated;
revoke execute on function public.founder_org_summary(uuid) from anon, public;

-- The club activity timeline is read-only too.
do $$
declare
  f record;
  d text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'founder_org_activity'
  loop
    d := regexp_replace(pg_get_functiondef(f.oid), '(public\.)?is_founder\(\)', 'public.is_founder_staff()', 'g');
    execute d;
  end loop;
end $$;
