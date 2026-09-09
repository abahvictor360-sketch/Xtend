-- =====================================================================
-- XTEND migration 006 — push notifications
--
-- Web Push subscriptions, the notifications an admin or supervisor sends,
-- and a per-recipient delivery record so the office can see who actually
-- received a message rather than assuming.
-- =====================================================================

create type notification_audience as enum ('everyone', 'role', 'outlet', 'users');

-- ---------------------------------------------------------------------
-- SUBSCRIPTIONS: one row per browser a user has enabled notifications on.
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade
                  default auth.uid(),
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  is_active     boolean not null default true,
  failure_count integer not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists push_subscriptions_user on public.push_subscriptions (user_id)
  where is_active;

alter table public.push_subscriptions enable row level security;

-- A device registers itself; nobody registers a device for someone else.
drop policy if exists push_subs_own_insert on public.push_subscriptions;
create policy push_subs_own_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists push_subs_own_select on public.push_subscriptions;
create policy push_subs_own_select on public.push_subscriptions
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists push_subs_own_update on public.push_subscriptions;
create policy push_subs_own_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subs_own_delete on public.push_subscriptions;
create policy push_subs_own_delete on public.push_subscriptions
  for delete using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- NOTIFICATIONS: what was sent, by whom, to whom.
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid references public.profiles(id) on delete set null,
  title         text not null check (length(trim(title)) between 1 and 80),
  body          text not null check (length(trim(body)) between 1 and 400),
  url           text,
  audience      notification_audience not null,
  audience_detail jsonb not null default '{}'::jsonb,
  recipients    integer not null default 0,
  delivered     integer not null default 0,
  failed        integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists notifications_recent on public.notifications (created_at desc);

alter table public.notifications enable row level security;

create table if not exists public.notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  status          text not null check (status in ('sent', 'failed', 'no_device')),
  detail          text,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists notification_deliveries_notification
  on public.notification_deliveries (notification_id);
create index if not exists notification_deliveries_user
  on public.notification_deliveries (user_id, created_at desc);

alter table public.notification_deliveries enable row level security;

drop policy if exists notification_deliveries_read on public.notification_deliveries;
create policy notification_deliveries_read on public.notification_deliveries
  for select using (user_id = auth.uid() or public.is_admin());

-- Senders and admins see the log; a recipient sees what was sent to them.
-- notifications.id is written out in full because notification_deliveries
-- has an "id" of its own that an unqualified reference would bind to.
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select using (
    public.is_admin()
    or sender_id = auth.uid()
    or exists (
      select 1 from public.notification_deliveries d
      where d.notification_id = public.notifications.id and d.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- TARGETING
--
-- Resolves an audience to a set of user ids, applying the caller's own
-- reach: an admin can address anyone, a supervisor only their own outlet.
-- Called with SECURITY DEFINER so the sender does not need to be able to
-- read every profile in order to address them.
-- ---------------------------------------------------------------------
create or replace function public.can_send_notifications()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('admin'::user_role, 'supervisor'::user_role)
     from public.profiles where id = auth.uid()),
    false);
$$;

create or replace function public.resolve_notification_targets(
  p_audience notification_audience,
  p_detail jsonb default '{}'::jsonb
)
returns table (user_id uuid, full_name text, role user_role, outlet_name text, devices integer)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.full_name,
    p.role,
    o.name,
    (select count(*)::int from public.push_subscriptions s
      where s.user_id = p.id and s.is_active)
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  where public.can_send_notifications()
    and p.is_active
    -- An admin reaches everyone. A supervisor reaches the field staff at
    -- their own outlet: not other supervisors, not admins, not themselves.
    and (
      public.is_admin()
      or (public.supervises_user(p.id) and public.is_field_role(p.role) and p.id <> auth.uid())
    )
    and case p_audience
          when 'everyone' then true
          when 'role' then p.role::text = (p_detail ->> 'role')
          when 'outlet' then p.outlet_id = (p_detail ->> 'outlet_id')::uuid
          when 'users' then p.id = any (
            select (jsonb_array_elements_text(coalesce(p_detail -> 'user_ids', '[]'::jsonb)))::uuid
          )
        end
  order by p.full_name;
$$;

revoke all on function public.resolve_notification_targets(notification_audience, jsonb) from public, anon;
grant execute on function public.resolve_notification_targets(notification_audience, jsonb)
  to authenticated, service_role;
revoke all on function public.can_send_notifications() from public, anon;
grant execute on function public.can_send_notifications() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- The field app's own inbox: what was sent to me, newest first.
-- ---------------------------------------------------------------------
create or replace function public.my_notifications(p_limit integer default 20)
returns table (
  id uuid,
  title text,
  body text,
  url text,
  sent_at timestamptz,
  sender_name text,
  read_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select n.id, n.title, n.body, n.url, n.created_at, s.full_name, d.read_at
  from public.notification_deliveries d
  join public.notifications n on n.id = d.notification_id
  left join public.profiles s on s.id = n.sender_id
  where d.user_id = auth.uid() and d.status = 'sent'
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.my_notifications(integer) from public, anon;
grant execute on function public.my_notifications(integer) to authenticated, service_role;

create or replace function public.mark_notifications_read()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update public.notification_deliveries
  set read_at = now()
  where user_id = auth.uid() and read_at is null and status = 'sent';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated, service_role;
