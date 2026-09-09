-- =====================================================================
-- XTEND: Field attendance and reporting for Xpel Beauty
-- Supabase / Postgres migration 001
-- Timezone of record: Africa/Lagos
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type user_role      as enum ('merchandiser', 'supervisor', 'admin');
create type attendance_type as enum ('opening', 'closing');
create type attendance_status as enum ('on_site', 'off_site', 'flagged');
create type alert_type     as enum ('left_geofence', 'low_accuracy', 'permission_denied', 'off_site_clock');

-- ---------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------

-- Haversine distance in metres. Avoids a PostGIS dependency.
create or replace function public.distance_metres(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ---------------------------------------------------------------------
-- OUTLETS
-- ---------------------------------------------------------------------
create table public.outlets (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  address           text,
  lat               double precision not null,
  lng               double precision not null,
  geofence_radius_m integer not null default 150 check (geofence_radius_m between 25 and 2000),
  shift_start       time not null default '08:00',
  shift_end         time not null default '18:00',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  phone        text,
  role         user_role not null default 'merchandiser',
  outlet_id    uuid references public.outlets(id) on delete set null,
  avatar_path  text,
  is_active    boolean not null default true,
  must_change_password boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on public.profiles (outlet_id);
create index on public.profiles (role) where is_active;

-- Role lookup as SECURITY DEFINER to avoid RLS recursion on profiles.
-- NOTE: named current_user_role, not current_role: CURRENT_ROLE is a reserved
-- SQL keyword and cannot be used as a function name.
create or replace function public.current_user_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'admin', false);
$$;


-- ---------------------------------------------------------------------
-- ATTENDANCE
-- Client sends: type, lat, lng, accuracy_m, selfie_path, address,
--               device_info, client_captured_at.
-- Server computes: user_id, outlet snapshot, distance_m, status,
--                  attendance_date, created_at.
-- ---------------------------------------------------------------------
create table public.attendance (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete restrict
                       default auth.uid(),
  outlet_id          uuid references public.outlets(id) on delete set null,
  outlet_lat         double precision,
  outlet_lng         double precision,
  outlet_radius_m    integer,
  type               attendance_type not null,
  lat                double precision not null,
  lng                double precision not null,
  accuracy_m         double precision not null,
  address            text,
  selfie_path        text not null,
  thumb_path         text,
  distance_m         double precision,
  status             attendance_status,
  device_info        jsonb not null default '{}'::jsonb,
  client_captured_at timestamptz not null,
  attendance_date    date,
  created_at         timestamptz not null default now()
);

-- One opening and one closing per person per day. Hard constraint.
create unique index attendance_one_per_type_per_day
  on public.attendance (user_id, attendance_date, type);

create index on public.attendance (attendance_date desc);
create index on public.attendance (user_id, attendance_date desc);
create index on public.attendance (status) where status <> 'on_site';

-- Server-side enforcement. The client never supplies distance or status.
create or replace function public.attendance_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o record;
begin
  new.user_id         := auth.uid();
  new.created_at      := now();
  new.attendance_date := (now() at time zone 'Africa/Lagos')::date;

  select p.outlet_id into new.outlet_id
  from public.profiles p where p.id = new.user_id;

  if new.outlet_id is not null then
    select lat, lng, geofence_radius_m into o
    from public.outlets where id = new.outlet_id;

    new.outlet_lat      := o.lat;
    new.outlet_lng      := o.lng;
    new.outlet_radius_m := o.geofence_radius_m;
    new.distance_m := public.distance_metres(new.lat, new.lng, o.lat, o.lng);
  end if;

  new.status := case
    when new.accuracy_m > 100 then 'flagged'::attendance_status
    when new.distance_m is null then 'flagged'::attendance_status
    when new.distance_m <= coalesce(new.outlet_radius_m, 150) then 'on_site'::attendance_status
    else 'off_site'::attendance_status
  end;

  -- Reject a stale or future capture timestamp outright.
  if new.client_captured_at > now() + interval '2 minutes'
     or new.client_captured_at < now() - interval '24 hours' then
    raise exception 'Invalid capture timestamp';
  end if;

  return new;
end;
$$;

create trigger trg_attendance_enforce
  before insert on public.attendance
  for each row execute function public.attendance_enforce();

-- Raise an alert automatically when a clock event lands outside the fence.
create or replace function public.attendance_alert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'on_site' then
    insert into public.location_alerts (user_id, attendance_id, alert_type, distance_m)
    values (
      new.user_id, new.id,
      case when new.accuracy_m > 100 then 'low_accuracy'::alert_type
           else 'off_site_clock'::alert_type end,
      new.distance_m
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- LOCATION PINGS (foreground heartbeat)
-- ---------------------------------------------------------------------
create table public.location_pings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade
                  default auth.uid(),
  attendance_id uuid references public.attendance(id) on delete cascade,
  lat           double precision not null,
  lng           double precision not null,
  accuracy_m    double precision not null,
  distance_m    double precision,
  created_at    timestamptz not null default now()
);

create index on public.location_pings (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- LOCATION ALERTS
-- ---------------------------------------------------------------------
create table public.location_alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  attendance_id uuid references public.attendance(id) on delete set null,
  alert_type    alert_type not null,
  distance_m    double precision,
  is_resolved   boolean not null default false,
  resolved_by   uuid references public.profiles(id),
  resolved_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);

create index on public.location_alerts (is_resolved, created_at desc);

create trigger trg_attendance_alert
  after insert on public.attendance
  for each row execute function public.attendance_alert();

-- ---------------------------------------------------------------------
-- REPORTS
-- ---------------------------------------------------------------------
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete restrict
                  default auth.uid(),
  outlet_id     uuid references public.outlets(id) on delete set null,
  report_date   date not null default (now() at time zone 'Africa/Lagos')::date,
  body          text,
  sales_summary text,
  stock_status  text,
  competitor_activity text,
  issues        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index reports_one_per_day on public.reports (user_id, report_date);

create table public.report_photos (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.reports(id) on delete cascade,
  storage_path text not null,
  caption      text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- AUDIT LOG
-- ---------------------------------------------------------------------
create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  target_table text,
  target_id    uuid,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index on public.audit_log (created_at desc);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles        enable row level security;
alter table public.outlets         enable row level security;
alter table public.attendance      enable row level security;
alter table public.location_pings  enable row level security;
alter table public.location_alerts enable row level security;
alter table public.reports         enable row level security;
alter table public.report_photos   enable row level security;
alter table public.audit_log       enable row level security;

-- PROFILES
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());
-- The role check goes through the SECURITY DEFINER helper. A plain subquery on
-- public.profiles inside a policy on public.profiles recurses infinitely.
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_user_role());
create policy profiles_admin_all on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- OUTLETS
create policy outlets_read on public.outlets
  for select using (auth.uid() is not null);
create policy outlets_admin_write on public.outlets
  for all using (public.is_admin()) with check (public.is_admin());

-- ATTENDANCE: insert own only, read own only, admins read all, nobody updates.
create policy attendance_insert_own on public.attendance
  for insert with check (
    auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
  );
create policy attendance_select_own on public.attendance
  for select using (user_id = auth.uid() or public.is_admin());
-- Deliberately no UPDATE or DELETE policy. Attendance is append-only.

-- PINGS
create policy pings_insert_own on public.location_pings
  for insert with check (auth.uid() is not null);
create policy pings_select on public.location_pings
  for select using (user_id = auth.uid() or public.is_admin());

-- ALERTS
create policy alerts_admin on public.location_alerts
  for all using (public.is_admin()) with check (public.is_admin());

-- REPORTS
create policy reports_own on public.reports
  for select using (user_id = auth.uid() or public.is_admin());
create policy reports_insert_own on public.reports
  for insert with check (auth.uid() is not null);
create policy reports_update_own_sameday on public.reports
  for update using (
    user_id = auth.uid()
    and report_date = (now() at time zone 'Africa/Lagos')::date
  );
create policy reports_admin on public.reports
  for all using (public.is_admin()) with check (public.is_admin());

create policy report_photos_access on public.report_photos
  for all using (
    exists (select 1 from public.reports r
            where r.id = report_id and (r.user_id = auth.uid() or public.is_admin()))
  ) with check (
    exists (select 1 from public.reports r
            where r.id = report_id and r.user_id = auth.uid())
  );

-- AUDIT LOG: admins read, nobody writes from the client.
create policy audit_admin_read on public.audit_log
  for select using (public.is_admin());

-- =====================================================================
-- STORAGE
-- Buckets are private. Access only via short-lived signed URLs.
-- =====================================================================
insert into storage.buckets (id, name, public) values ('selfies', 'selfies', false)
  on conflict do nothing;
insert into storage.buckets (id, name, public) values ('reports', 'reports', false)
  on conflict do nothing;

-- Users write only into their own folder: selfies/<uid>/<file>
create policy selfies_insert_own on storage.objects
  for insert with check (
    bucket_id = 'selfies' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy selfies_read on storage.objects
  for select using (
    bucket_id = 'selfies'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
create policy reports_insert_own on storage.objects
  for insert with check (
    bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy reports_read on storage.objects
  for select using (
    bucket_id = 'reports'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- =====================================================================
-- RETENTION: run nightly via pg_cron or a Vercel cron route.
-- Deletes the full-size selfie after 90 days, keeps the thumbnail.
-- =====================================================================
create or replace function public.purge_old_selfies()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with expired as (
    select selfie_path from public.attendance
    where created_at < now() - interval '90 days'
      and selfie_path is not null
      and thumb_path is not null
  )
  delete from storage.objects o
  using expired e
  where o.bucket_id = 'selfies' and o.name = e.selfie_path;

  get diagnostics n = row_count;

  update public.attendance
  set selfie_path = thumb_path
  where created_at < now() - interval '90 days'
    and thumb_path is not null
    and selfie_path <> thumb_path;

  return n;
end;
$$;
