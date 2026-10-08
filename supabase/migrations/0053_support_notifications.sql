-- =====================================================================
-- 0053: Support inbox and notifications, advanced
--
-- Support
--   * a thread can be given to one person in the office (assigned_to), who
--     must be someone already told about that member (an admin, or a
--     supervisor who supervises them);
--   * a closed thread can be reopened by the office;
--   * support_inbox: the office list with how long the member has been
--     waiting for a person to answer, the last sender and the assignee;
--   * saved quick replies the office can drop into a reply.
--
-- Notifications
--   * whoever sent a notification can see who received it (before, only
--     admins could read the delivery rows);
--   * notification_log: the history with the sender's name, what kind of
--     message it was, and how many read it;
--   * saved templates (title and message) to reuse;
--   * scheduled sends. The audience is worked out, with the sender's own
--     reach, when it is scheduled; the five-minute job (/api/cron/alerts)
--     sends it when it is due. Nobody can write a schedule row directly.
-- =====================================================================

-- ---------------------------------------------------------------------
-- An office member's name, for showing who closed, was given or sent
-- something. Only office roles are named, and only to the office.
-- ---------------------------------------------------------------------
create or replace function public.office_name(p uuid)
returns text
language sql stable security definer set search_path = public as $$
  select pr.full_name
  from public.profiles pr
  where pr.id = p
    and pr.role in ('admin'::user_role, 'supervisor'::user_role)
    and public.can_send_notifications();
$$;
revoke all on function public.office_name(uuid) from public, anon;
grant execute on function public.office_name(uuid) to authenticated, service_role;

-- =====================================================================
-- SUPPORT
-- =====================================================================
alter table public.support_threads
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.support_threads
  add column if not exists assigned_at timestamptz;

create index if not exists support_threads_assigned
  on public.support_threads (assigned_to, last_message_at desc) where assigned_to is not null;

-- Who in the office a thread can be given to: the people told about that
-- member (every admin, and the supervisors who supervise them).
create or replace function public.support_assignees(p_thread uuid)
returns table (user_id uuid, full_name text, role user_role)
language plpgsql stable security definer set search_path = public as $$
declare
  owner uuid;
begin
  select t.user_id into owner from public.support_threads t where t.id = p_thread;
  if owner is null then raise exception 'No such thread'; end if;
  if not (public.is_admin() or public.supervises_user(owner)) then
    raise exception 'That thread is not yours';
  end if;
  return query
    select w.user_id, w.full_name, w.role
    from public.alert_watchers(owner) w
    order by (w.user_id = auth.uid()) desc, w.full_name;
end;
$$;
revoke all on function public.support_assignees(uuid) from public, anon;
grant execute on function public.support_assignees(uuid) to authenticated, service_role;

-- Fix: 031's version set the status from a CASE of bare strings, which
-- Postgres types as text and will not put in a support_status column, so
-- every office reply and every follow-up from a member failed. Same rules,
-- with the values typed.
create or replace function public.post_support_message(p_thread uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t record;
  role_val support_sender;
  mid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'Message is empty'; end if;

  select * into t from public.support_threads where id = p_thread;
  if t.id is null then raise exception 'No such thread'; end if;

  if t.user_id = uid then
    role_val := 'staff';
  elsif public.is_admin() then
    role_val := 'admin';
  elsif public.supervises_user(t.user_id) then
    role_val := 'supervisor';
  else
    raise exception 'That thread is not yours';
  end if;

  insert into public.support_messages (thread_id, sender_id, sender_role, body)
  values (p_thread, uid, role_val, left(btrim(p_body), 4000))
  returning id into mid;

  update public.support_threads
  set last_message_at = now(),
      -- The member writing again needs attention; the office writing has
      -- given it. Neither closes the thread: that is an explicit action.
      status = case when role_val = 'staff' then 'open'::support_status
                    else 'ai_answered'::support_status end
  where id = p_thread;

  return mid;
end;
$$;

revoke all on function public.post_support_message(uuid, text) from public, anon;
grant execute on function public.post_support_message(uuid, text) to authenticated, service_role;

-- Give a thread to someone (or to nobody, with null).
create or replace function public.assign_support_thread(p_thread uuid, p_assignee uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  select t.user_id into owner from public.support_threads t where t.id = p_thread;
  if owner is null then raise exception 'No such thread'; end if;
  if not (public.is_admin() or public.supervises_user(owner)) then
    raise exception 'That thread is not yours';
  end if;
  if p_assignee is not null
     and not exists (select 1 from public.alert_watchers(owner) w where w.user_id = p_assignee) then
    raise exception 'That person cannot take this thread';
  end if;
  update public.support_threads
  set assigned_to = p_assignee,
      assigned_at = case when p_assignee is null then null else now() end
  where id = p_thread;
end;
$$;
revoke all on function public.assign_support_thread(uuid, uuid) from public, anon;
grant execute on function public.assign_support_thread(uuid, uuid) to authenticated, service_role;

-- Reopen a closed thread: it goes back to the office.
create or replace function public.reopen_support_thread(p_thread uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
begin
  select * into t from public.support_threads where id = p_thread;
  if t.id is null then raise exception 'No such thread'; end if;
  if not (public.is_admin() or public.supervises_user(t.user_id)) then
    raise exception 'That thread is not yours to reopen';
  end if;
  if t.status <> 'resolved' then raise exception 'That thread is not closed'; end if;
  update public.support_threads
  set status = 'escalated', escalated_at = now(), resolved_at = null, resolved_by = null
  where id = p_thread;
end;
$$;
revoke all on function public.reopen_support_thread(uuid) from public, anon;
grant execute on function public.reopen_support_thread(uuid) to authenticated, service_role;

-- The office inbox. waiting_since is when the member's oldest message not
-- yet answered by a person was sent (or, failing that, when the thread was
-- passed to the office); it is null when nothing is waiting.
create or replace view public.support_inbox
with (security_invoker = true) as
  select t.id, t.user_id, p.full_name as staff_name, p.role as staff_role,
         t.subject, t.status, t.outlet_id, o.name as outlet_name,
         t.created_at, t.last_message_at, t.escalated_at, t.resolved_at,
         public.office_name(t.resolved_by) as resolved_by_name,
         t.assigned_to, public.office_name(t.assigned_to) as assigned_name, t.assigned_at,
         s.message_count, s.last_body, s.last_sender, s.last_office_at, s.office_replies,
         case when t.status in ('open', 'escalated')
              then coalesce(w.first_unanswered_at, t.escalated_at, t.last_message_at)
         end as waiting_since
  from public.support_threads t
  join public.profiles p on p.id = t.user_id
  left join public.outlets o on o.id = t.outlet_id
  cross join lateral (
    select count(*)::int as message_count,
           (array_agg(m.body order by m.created_at desc))[1] as last_body,
           (array_agg(m.sender_role order by m.created_at desc))[1] as last_sender,
           max(m.created_at) filter (where m.sender_role in ('admin', 'supervisor')) as last_office_at,
           (count(*) filter (where m.sender_role in ('admin', 'supervisor')))::int as office_replies
    from public.support_messages m
    where m.thread_id = t.id
  ) s
  cross join lateral (
    select min(m.created_at) as first_unanswered_at
    from public.support_messages m
    where m.thread_id = t.id
      and m.sender_role = 'staff'
      and m.created_at > coalesce(s.last_office_at, '-infinity'::timestamptz)
  ) w;

grant select on public.support_inbox to authenticated;

-- Saved answers. Every office member can use them; each keeps their own,
-- and admins look after all of them (including the starter set).
create table if not exists public.support_quick_replies (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 60),
  body        text not null check (length(btrim(body)) between 1 and 1000),
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.support_quick_replies enable row level security;

drop policy if exists support_quick_replies_read on public.support_quick_replies;
create policy support_quick_replies_read on public.support_quick_replies
  for select using (public.can_send_notifications());
drop policy if exists support_quick_replies_add on public.support_quick_replies;
create policy support_quick_replies_add on public.support_quick_replies
  for insert with check (public.can_send_notifications() and created_by = auth.uid());
drop policy if exists support_quick_replies_change on public.support_quick_replies;
create policy support_quick_replies_change on public.support_quick_replies
  for update using (public.is_admin() or (created_by = auth.uid() and public.can_send_notifications()))
  with check (public.is_admin() or (created_by = auth.uid() and public.can_send_notifications()));
drop policy if exists support_quick_replies_remove on public.support_quick_replies;
create policy support_quick_replies_remove on public.support_quick_replies
  for delete using (public.is_admin() or (created_by = auth.uid() and public.can_send_notifications()));

revoke all on public.support_quick_replies from anon;
grant select, insert, update, delete on public.support_quick_replies to authenticated;

insert into public.support_quick_replies (title, body, created_by)
select v.title, v.body, null
from (values
  ('Looking into it', 'Hello {name}, thank you for telling us. We are looking into it now and will get back to you shortly.'),
  ('Try clock-in again', 'Hello {name}, please close Xtend completely, make sure Location, Camera and Notifications are allowed, stand outside in the open for a minute, then try to clock in again. Tell us here if it still does not work.'),
  ('Fixed, try again', 'Hello {name}, this has been fixed on our side. Please try again now and let us know if anything is still wrong.'),
  ('Store change done', 'Hello {name}, your store has been updated. Close and open Xtend again to see it.'),
  ('Call your supervisor', 'Hello {name}, please call your supervisor about this today so they can sort it out with you directly.')
) as v(title, body)
where not exists (select 1 from public.support_quick_replies);

-- =====================================================================
-- NOTIFICATIONS
-- =====================================================================

-- Whoever sent a notification may see who received it. Through a
-- security definer helper: notifications' own policy reads the delivery
-- rows, so reading notifications back here directly would recurse.
create or replace function public.notification_sent_by_me(p_notification uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.notifications n
    where n.id = p_notification and n.sender_id = auth.uid() and n.sender_id is not null
  );
$$;
revoke all on function public.notification_sent_by_me(uuid) from public, anon;
grant execute on function public.notification_sent_by_me(uuid) to authenticated, service_role;

drop policy if exists notification_deliveries_sender_read on public.notification_deliveries;
create policy notification_deliveries_sender_read on public.notification_deliveries
  for select using (public.notification_sent_by_me(notification_id));

-- The history, with who sent it and how many read it.
create or replace view public.notification_log
with (security_invoker = true) as
  select n.id, n.sender_id, public.office_name(n.sender_id) as sender_name,
         n.title, n.body, n.url, n.audience, n.audience_detail,
         n.recipients, n.delivered, n.failed, n.created_at,
         case
           when n.audience_detail->>'kind' like 'support%' then 'support'
           when n.sender_id is null or n.audience_detail->>'system' = 'true'
                or n.audience_detail ? 'kind' then 'alert'
           else 'message'
         end as kind,
         (select count(*)::int from public.notification_deliveries d
          where d.notification_id = n.id and d.read_at is not null) as read_count,
         (select count(*)::int from public.notification_deliveries d
          where d.notification_id = n.id and d.status = 'no_device') as no_device
  from public.notifications n;

grant select on public.notification_log to authenticated;

-- Saved title and message pairs.
create table if not exists public.notification_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 80),
  body        text not null check (length(btrim(body)) between 1 and 400),
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.notification_templates enable row level security;

drop policy if exists notification_templates_read on public.notification_templates;
create policy notification_templates_read on public.notification_templates
  for select using (public.can_send_notifications());
drop policy if exists notification_templates_add on public.notification_templates;
create policy notification_templates_add on public.notification_templates
  for insert with check (public.can_send_notifications() and created_by = auth.uid());
drop policy if exists notification_templates_change on public.notification_templates;
create policy notification_templates_change on public.notification_templates
  for update using (public.is_admin() or (created_by = auth.uid() and public.can_send_notifications()))
  with check (public.is_admin() or (created_by = auth.uid() and public.can_send_notifications()));
drop policy if exists notification_templates_remove on public.notification_templates;
create policy notification_templates_remove on public.notification_templates
  for delete using (public.is_admin() or (created_by = auth.uid() and public.can_send_notifications()));

revoke all on public.notification_templates from anon;
grant select, insert, update, delete on public.notification_templates to authenticated;

insert into public.notification_templates (title, body, created_by)
select v.title, v.body, null
from (values
  ('Clock in on time', 'Good morning. Please remember to clock in at your store by 8:00 today.'),
  ('Daily report', 'Please file your daily report in Xtend before you clock out today.'),
  ('Stock delivery today', 'A stock delivery is coming to your store today. Please be on the floor to receive and count it.'),
  ('Stock count needed', 'Please do a stock count at your store today and submit it in Xtend.')
) as v(title, body)
where not exists (select 1 from public.notification_templates);

-- Scheduled sends.
create table if not exists public.scheduled_notifications (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid references public.profiles(id) on delete set null,
  title           text not null check (length(btrim(title)) between 1 and 80),
  body            text not null check (length(btrim(body)) between 1 and 400),
  url             text check (url is null or (length(url) <= 300 and url ~ '^/([^/\\]|$)')),
  audience        notification_audience not null,
  audience_detail jsonb not null default '{}'::jsonb,
  -- Worked out with the sender's reach when it was scheduled.
  user_ids        uuid[] not null,
  send_at         timestamptz not null,
  status          text not null default 'scheduled'
                    check (status in ('scheduled', 'sending', 'sent', 'cancelled', 'failed')),
  claimed_at      timestamptz,
  notification_id uuid references public.notifications(id) on delete set null,
  error           text,
  cancelled_by    uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists scheduled_notifications_due
  on public.scheduled_notifications (send_at) where status = 'scheduled';

alter table public.scheduled_notifications enable row level security;

drop policy if exists scheduled_notifications_read on public.scheduled_notifications;
create policy scheduled_notifications_read on public.scheduled_notifications
  for select using (public.is_admin() or created_by = auth.uid());

revoke insert, update, delete, truncate on public.scheduled_notifications from anon, authenticated;

create or replace function public.schedule_notification(
  p_title text, p_body text, p_url text,
  p_audience notification_audience, p_detail jsonb, p_send_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
  sid uuid;
begin
  if not public.can_send_notifications() then raise exception 'Admins and supervisors only'; end if;
  if p_send_at is null or p_send_at < now() + interval '2 minutes' then
    raise exception 'Pick a time at least a few minutes from now';
  end if;
  if p_send_at > now() + interval '60 days' then
    raise exception 'Pick a time within the next 60 days';
  end if;
  select array_agg(r.user_id) into ids
  from public.resolve_notification_targets(p_audience, coalesce(p_detail, '{}'::jsonb)) r;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'That audience matches nobody'; end if;

  insert into public.scheduled_notifications
    (created_by, title, body, url, audience, audience_detail, user_ids, send_at)
  values (auth.uid(), btrim(p_title), btrim(p_body), nullif(btrim(coalesce(p_url, '')), ''),
          p_audience, coalesce(p_detail, '{}'::jsonb), ids, p_send_at)
  returning id into sid;
  return sid;
end;
$$;
revoke all on function public.schedule_notification(text, text, text, notification_audience, jsonb, timestamptz) from public, anon;
grant execute on function public.schedule_notification(text, text, text, notification_audience, jsonb, timestamptz)
  to authenticated, service_role;

create or replace function public.cancel_scheduled_notification(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  select * into s from public.scheduled_notifications where id = p_id;
  if s.id is null then raise exception 'No such scheduled notification'; end if;
  if not (public.is_admin() or (s.created_by = auth.uid() and public.can_send_notifications())) then
    raise exception 'That is not yours to cancel';
  end if;
  if s.status <> 'scheduled' then raise exception 'It has already gone or been cancelled'; end if;
  update public.scheduled_notifications
  set status = 'cancelled', cancelled_by = auth.uid()
  where id = p_id and status = 'scheduled';
end;
$$;
revoke all on function public.cancel_scheduled_notification(uuid) from public, anon;
grant execute on function public.cancel_scheduled_notification(uuid) to authenticated, service_role;

-- "Send now" on a scheduled one: takes it off the schedule so the job
-- cannot send it as well, and hands it back to the caller to send.
create or replace function public.claim_scheduled_notification(p_id uuid)
returns setof public.scheduled_notifications
language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  select * into s from public.scheduled_notifications where id = p_id;
  if s.id is null then raise exception 'No such scheduled notification'; end if;
  if not (public.is_admin() or (s.created_by = auth.uid() and public.can_send_notifications())) then
    raise exception 'That is not yours to send';
  end if;
  return query
    update public.scheduled_notifications
    set status = 'sending', claimed_at = now()
    where id = p_id and status = 'scheduled'
    returning *;
  if not found then raise exception 'It has already gone or been cancelled'; end if;
end;
$$;
revoke all on function public.claim_scheduled_notification(uuid) from public, anon;
grant execute on function public.claim_scheduled_notification(uuid) to authenticated, service_role;

-- The job's side: everything due, each taken once. One left half-sent by a
-- crash is marked failed rather than sent twice.
create or replace function public.claim_due_notifications(p_limit integer default 20)
returns setof public.scheduled_notifications
language plpgsql security definer set search_path = public as $$
begin
  update public.scheduled_notifications
  set status = 'failed', error = 'Interrupted while sending. Check the history before sending it again.'
  where status = 'sending' and claimed_at < now() - interval '15 minutes';

  return query
    update public.scheduled_notifications s
    set status = 'sending', claimed_at = now()
    where s.id in (
      select d.id from public.scheduled_notifications d
      where d.status = 'scheduled' and d.send_at <= now()
      order by d.send_at
      limit greatest(1, least(coalesce(p_limit, 20), 100))
      for update skip locked
    )
    returning s.*;
end;
$$;
revoke all on function public.claim_due_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(integer) to service_role;
