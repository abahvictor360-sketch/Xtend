-- =====================================================================
-- XTEND migration 011 — allocating stores to field staff
--
-- profiles.outlet_id names the one store a person belongs to. That was
-- enough while everybody sat in a single shop, but a marketer works a
-- round of three or four, and a merchandiser can cover two branches in a
-- week. So allocation becomes a set: admins and supervisors decide which
-- stores a person is responsible for, and the rest of the system follows.
--
--   * the store picker offers their stores first
--   * the daily clock measures against whichever of their stores is
--     nearest, instead of only the home outlet
--   * a supervisor sees anyone allocated to their outlet
--
-- profiles.outlet_id stays as the home store: it is what a person defaults
-- to, and what a supervisor's own reach is anchored on.
-- =====================================================================

create table if not exists public.staff_outlets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  outlet_id   uuid not null references public.outlets(id)  on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, outlet_id)
);

create index if not exists staff_outlets_by_user on public.staff_outlets (user_id);
create index if not exists staff_outlets_by_outlet on public.staff_outlets (outlet_id);

-- ---------------------------------------------------------------------
-- Who may change somebody's allocation: an admin, or the supervisor whose
-- team they are already on. A supervisor cannot allocate to another
-- supervisor, nor to an admin, nor to themselves.
-- ---------------------------------------------------------------------
create or replace function public.can_allocate_outlets(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.supervises_user(target)
          and exists (select 1 from public.profiles p
                      where p.id = target and public.is_field_role(p.role)));
$$;

revoke all on function public.can_allocate_outlets(uuid) from public, anon;
grant execute on function public.can_allocate_outlets(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- The stores a person is responsible for. Their home outlet counts as one
-- of them, so nobody is left with an empty list by an allocation that was
-- never made.
-- ---------------------------------------------------------------------
create or replace function public.outlets_for_user(target uuid)
returns table (outlet_id uuid)
language sql stable security definer set search_path = public as $$
  select o.id
  from public.outlets o
  where o.is_active
    and (o.id in (select s.outlet_id from public.staff_outlets s where s.user_id = target)
         or o.id = (select p.outlet_id from public.profiles p where p.id = target));
$$;

revoke all on function public.outlets_for_user(uuid) from public, anon;
grant execute on function public.outlets_for_user(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- A supervisor's reach grows with allocation: anyone allocated to the
-- supervisor's own outlet is on their team, not only those whose home
-- outlet matches. Admins and other supervisors are never pulled in.
-- ---------------------------------------------------------------------
create or replace function public.supervises_user(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles them on them.id = target
    where me.id = auth.uid()
      and me.role = 'supervisor'
      and me.outlet_id is not null
      and (
        them.outlet_id = me.outlet_id
        or (public.is_field_role(them.role)
            and exists (select 1 from public.staff_outlets s
                        where s.user_id = them.id and s.outlet_id = me.outlet_id))
      )
  );
$$;

-- ---------------------------------------------------------------------
-- Allocation is written as a whole set, in one statement, so a half-saved
-- list cannot exist. The caller sends the stores the person should have;
-- the database works out what to add and what to drop.
-- ---------------------------------------------------------------------
create or replace function public.set_staff_outlets(p_user_id uuid, p_outlet_ids uuid[])
returns setof uuid
language plpgsql security definer set search_path = public as $$
declare
  wanted uuid[] := coalesce(p_outlet_ids, '{}'::uuid[]);
begin
  if not public.can_allocate_outlets(p_user_id) then
    raise exception 'You cannot change that person''s stores';
  end if;

  if exists (
    select 1 from unnest(wanted) as w(id)
    where not exists (select 1 from public.outlets o where o.id = w.id and o.is_active)
  ) then
    raise exception 'One of those stores does not exist or is no longer active';
  end if;

  delete from public.staff_outlets
  where user_id = p_user_id and outlet_id <> all (wanted);

  insert into public.staff_outlets (user_id, outlet_id, assigned_by)
  select p_user_id, w.id, auth.uid() from unnest(wanted) as w(id)
  on conflict (user_id, outlet_id) do nothing;

  -- Supervisors may allocate but may not call write_audit, so the row is
  -- written here where the trail cannot be skipped.
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), 'staff.allocate_outlets', 'staff_outlets', p_user_id,
          jsonb_build_object('outlet_ids', to_jsonb(wanted), 'count', array_length(wanted, 1)));

  return query
    select s.outlet_id from public.staff_outlets s where s.user_id = p_user_id;
end;
$$;

revoke all on function public.set_staff_outlets(uuid, uuid[]) from public, anon;
grant execute on function public.set_staff_outlets(uuid, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- The daily clock now measures against whichever of the person's stores
-- they are closest to. With no allocation this is the home outlet and the
-- behaviour is exactly what it was.
-- ---------------------------------------------------------------------
create or replace function public.attendance_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o record;
begin
  new.user_id         := auth.uid();
  new.created_at      := now();
  new.attendance_date := public.business_date();

  select ot.id, ot.lat, ot.lng, ot.geofence_radius_m,
         public.distance_metres(new.lat, new.lng, ot.lat, ot.lng) as distance_m
    into o
  from public.outlets ot
  where ot.id in (select outlet_id from public.outlets_for_user(new.user_id))
  order by public.distance_metres(new.lat, new.lng, ot.lat, ot.lng)
  limit 1;

  if o.id is not null then
    new.outlet_id       := o.id;
    new.outlet_lat      := o.lat;
    new.outlet_lng      := o.lng;
    new.outlet_radius_m := o.geofence_radius_m;
    new.distance_m      := o.distance_m;
  else
    new.outlet_id  := null;
    new.distance_m := null;
  end if;

  new.status := case
    when new.accuracy_m > 100 then 'flagged'::attendance_status
    when new.distance_m is null then 'flagged'::attendance_status
    when new.distance_m <= coalesce(new.outlet_radius_m, 150) then 'on_site'::attendance_status
    else 'off_site'::attendance_status
  end;

  if new.client_captured_at > now() + interval '2 minutes'
     or new.client_captured_at < now() - interval '24 hours' then
    raise exception 'Invalid capture timestamp';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- A merchandiser allocated more than one store needs to say which one
-- they are in; with a single store the daily clock already answers that.
-- ---------------------------------------------------------------------
create or replace function public.can_visit_stores()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p.role
      when 'marketer'::user_role then true
      when 'admin'::user_role then true
      when 'merchandiser'::user_role then
        (select count(*) from public.outlets_for_user(p.id)) > 1
      else false
    end
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

-- ---------------------------------------------------------------------
-- A store visit must be to one of the person's own stores. Checking in
-- somewhere they were never allocated is a mistake worth refusing, not a
-- visit worth recording.
-- ---------------------------------------------------------------------
create or replace function public.store_visit_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o record;
begin
  if not public.can_visit_stores() then
    raise exception 'Only marketers record store visits';
  end if;

  new.user_id    := auth.uid();
  new.created_at := now();
  new.arrived_at := now();
  new.visit_date := public.business_date();
  new.status     := 'open';

  -- Departure fields are never accepted on the way in.
  new.departed_at := null;
  new.departed_lat := null;
  new.departed_lng := null;
  new.departed_distance_m := null;
  new.departed_status := null;

  select lat, lng, geofence_radius_m, is_active into o
  from public.outlets where id = new.outlet_id;

  if o is null then
    raise exception 'That store does not exist';
  end if;
  if not o.is_active then
    raise exception 'That store is no longer active';
  end if;
  if not public.is_admin()
     and new.outlet_id not in (select outlet_id from public.outlets_for_user(new.user_id)) then
    raise exception 'That store is not one of yours';
  end if;

  new.outlet_lat      := o.lat;
  new.outlet_lng      := o.lng;
  new.outlet_radius_m := o.geofence_radius_m;
  new.arrived_distance_m :=
    public.distance_metres(new.arrived_lat, new.arrived_lng, o.lat, o.lng);

  new.arrived_status := case
    when new.arrived_accuracy_m > 100 then 'flagged'::attendance_status
    when new.arrived_distance_m <= o.geofence_radius_m then 'on_site'::attendance_status
    else 'off_site'::attendance_status
  end;

  if new.client_captured_at > now() + interval '2 minutes'
     or new.client_captured_at < now() - interval '24 hours' then
    raise exception 'Invalid capture timestamp';
  end if;

  return new;
end;
$$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.staff_outlets enable row level security;

drop policy if exists staff_outlets_select on public.staff_outlets;
create policy staff_outlets_select on public.staff_outlets
  for select using (
    user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id)
  );

-- Writes go through set_staff_outlets(), which is the only thing that can
-- keep the set consistent. No insert, update or delete policy exists, and
-- the grants are withdrawn too so the table is read-only over the API.
revoke insert, update, delete, truncate on public.staff_outlets from anon, authenticated;
revoke all on public.staff_outlets from anon;

-- =====================================================================
-- READ MODELS
-- =====================================================================
create or replace view public.staff_allocation
with (security_invoker = true) as
  select
    p.id            as user_id,
    p.full_name     as staff_name,
    p.role,
    p.is_active,
    p.outlet_id     as home_outlet_id,
    home.name       as home_outlet_name,
    coalesce(
      (select array_agg(o.name order by o.name)
       from public.staff_outlets s join public.outlets o on o.id = s.outlet_id
       where s.user_id = p.id),
      '{}'::text[]
    ) as outlet_names,
    coalesce(
      (select array_agg(s.outlet_id) from public.staff_outlets s where s.user_id = p.id),
      '{}'::uuid[]
    ) as outlet_ids
  from public.profiles p
  left join public.outlets home on home.id = p.outlet_id
  where public.is_field_role(p.role);

-- The stores the signed-in person may check into today.
create or replace function public.my_outlets()
returns setof public.outlets
language sql stable security definer set search_path = public as $$
  select o.* from public.outlets o
  where o.id in (select outlet_id from public.outlets_for_user(auth.uid()))
  order by o.name;
$$;

revoke all on function public.my_outlets() from public, anon;
grant execute on function public.my_outlets() to authenticated, service_role;
