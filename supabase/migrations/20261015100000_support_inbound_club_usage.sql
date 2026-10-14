-- Support inbox: mail sent to support@ becomes a ticket on its own, and a
-- per-club feature usage report for the founder console.
--
--   support_inbound_message()   called only by the support-inbound edge function
--       (SendGrid Inbound Parse). Starts a ticket, or adds to the one named by
--       the "[Ticket xxxxxxxx]" tag our replies carry, and ignores a message it
--       has already stored (SendGrid retries on any non-2xx answer).
--   founder_analytics_club_usage()   club -> features, the reverse of the
--       existing founder_analytics_feature_accounts() (feature -> clubs).

-- ---------------------------------------------------------------------------
-- Inbound mail
-- ---------------------------------------------------------------------------

alter table public.support_messages
  add column if not exists message_id text;

-- A given Message-ID is stored once, so a retried delivery can't double-post.
create unique index if not exists support_messages_message_id_key
  on public.support_messages (message_id) where message_id is not null;

create or replace function public.support_inbound_message(
  p_email text,
  p_subject text,
  p_body text,
  p_message_id text default null,
  p_ticket_ref text default null
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_subject text := left(trim(coalesce(p_subject, '')), 200);
  v_body    text := left(trim(coalesce(p_body, '')), 20000);
  v_msgid   text := nullif(left(trim(coalesce(p_message_id, '')), 500), '');
  v_ticket  uuid;
  v_created boolean := false;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid sender is required' using errcode = '22023';
  end if;
  if v_body = '' then
    v_body := '(no message body)';
  end if;
  if v_subject = '' then
    v_subject := '(no subject)';
  end if;

  if v_msgid is not null then
    select m.ticket_id into v_ticket from public.support_messages m where m.message_id = v_msgid;
    if found then
      return jsonb_build_object('ticket_id', v_ticket, 'created', false, 'duplicate', true);
    end if;
  end if;

  -- Only the person the ticket belongs to can add to it by tag; anyone else
  -- quoting a tag gets a ticket of their own.
  if p_ticket_ref is not null and p_ticket_ref ~ '^[0-9a-fA-F]{8}$' then
    select t.id into v_ticket
      from public.support_tickets t
     where t.id::text like lower(p_ticket_ref) || '%'
       and t.email = v_email
     limit 1;
  end if;

  if v_ticket is null then
    insert into public.support_tickets (email, user_id, subject)
    values (v_email, (select p.id from public.profiles p where lower(p.email) = v_email limit 1), v_subject)
    returning id into v_ticket;
    v_created := true;
  else
    update public.support_tickets set status = 'open', updated_at = now() where id = v_ticket;
  end if;

  begin
    insert into public.support_messages (ticket_id, direction, body, author_email, message_id)
    values (v_ticket, 'inbound', v_body, v_email, v_msgid);
  exception when unique_violation then
    -- Lost a race with a retry of the same delivery.
    return jsonb_build_object('ticket_id', v_ticket, 'created', false, 'duplicate', true);
  end;

  return jsonb_build_object('ticket_id', v_ticket, 'created', v_created, 'duplicate', false);
end;
$$;

revoke all on function public.support_inbound_message(text, text, text, text, text) from public;
revoke all on function public.support_inbound_message(text, text, text, text, text) from anon;
revoke all on function public.support_inbound_message(text, text, text, text, text) from authenticated;
grant execute on function public.support_inbound_message(text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Per-club feature usage
-- ---------------------------------------------------------------------------

-- One row per club and feature over the period. Guardians have no club and
-- aren't listed. p_platform: null = both, or 'web' / 'mobile'.
create or replace function public.founder_analytics_club_usage(p_days int default 30, p_platform text default null)
returns table (
  account_id    uuid,
  account_name  text,
  plan_tier     text,
  feature       text,
  users         bigint,
  active_days   bigint,
  uses          bigint,
  web_uses      bigint,
  mobile_uses   bigint,
  last_used_at  timestamptz
) language plpgsql stable security definer set search_path = public as $$
declare
  v_since date := (now() at time zone 'utc')::date - (greatest(1, least(coalesce(p_days, 30), 730)) - 1);
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select u.account_id,
         a.name,
         a.plan_tier::text,
         u.feature,
         count(distinct u.user_id),
         count(distinct (u.user_id, u.day)),
         coalesce(sum(u.uses), 0)::bigint,
         coalesce(sum(u.uses) filter (where u.platform = 'web'), 0)::bigint,
         coalesce(sum(u.uses) filter (where u.platform = 'mobile'), 0)::bigint,
         max(u.last_used_at)
    from public.analytics_feature_usage u
    join public.accounts a on a.id = u.account_id
   where u.day >= v_since
     and (p_platform is null or u.platform = p_platform)
   group by u.account_id, a.name, a.plan_tier, u.feature
   order by a.name, u.feature
   limit 20000;
end;
$$;

grant execute on function public.founder_analytics_club_usage(int, text) to authenticated;
