-- =====================================================================
-- XTEND migration 0106 — On site only
--
-- Clocking in, or checking in at a store, from outside the store was
-- allowed and marked "off site". Now it is refused, with where to go:
-- "You are off site: 420 m from Ikeja City Mall. Go to Ikeja City Mall
-- (Obafemi Awolowo Way), then clock in there."
--
--   * too_far(distance, radius, accuracy): beyond the store's area,
--     allowing up to 50 m of the phone's stated accuracy (the app uses the
--     same rule, lib/on-site.ts);
--   * a clock-in measured against a store (their nearest store, or the
--     store a marketer picked, 0101) that is too far is refused, with hint
--     'off_site' and the store as JSON in the detail;
--   * a store check-in the same; a marketer with stores of their own who
--     is in none of them is refused, with the nearest one;
--   * not refused: clock-outs and check-outs (they may have left), stores
--     still waiting for their location, a location too rough to measure
--     (accuracy over 100 m is refused by the phone), and entries the
--     office makes (0090);
--   * system_settings.block_off_site (default on) turns it off:
--       update public.system_settings set block_off_site = false;
--
-- Rerunnable.
-- =====================================================================

alter table public.system_settings add column if not exists block_off_site boolean not null default true;
comment on column public.system_settings.block_off_site is
  'Refuse clock-ins and store check-ins made outside the store (0106).';

create or replace function public.off_site_blocked()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.block_off_site from public.system_settings s where s.id), true);
$$;
revoke all on function public.off_site_blocked() from public, anon;
grant execute on function public.off_site_blocked() to authenticated, service_role;

create or replace function public.too_far(p_distance double precision, p_radius double precision, p_accuracy double precision)
returns boolean
language sql immutable as $$
  select p_distance is not null
     and p_distance > coalesce(p_radius, 150) + least(greatest(coalesce(p_accuracy, 0), 0), 50);
$$;

create or replace function public.distance_words(p_m double precision)
returns text
language sql immutable as $$
  select case when p_m >= 1000 then to_char(round((p_m / 1000.0)::numeric, 1), 'FM999990.0') || ' km'
              else round(p_m)::bigint || ' m' end;
$$;

-- The refusal, in the words the app shows, with the store for directions.
create or replace function public.refuse_off_site(p_store uuid, p_distance double precision, p_radius double precision, p_task text)
returns void
language plpgsql stable security definer set search_path = public as $$
declare
  o record;
  words text;
begin
  select x.id, x.name, x.address, x.lat, x.lng into o from public.outlets x where x.id = p_store;
  words := format('You are off site: %s from %s. Go to %s%s, then %s there.',
                  public.distance_words(p_distance), o.name, o.name,
                  coalesce(' (' || nullif(btrim(o.address), '') || ')', ''), p_task);
  raise exception '%', words
    using hint = 'off_site',
          detail = jsonb_build_object(
            'store', jsonb_build_object('id', o.id, 'name', o.name, 'address', o.address, 'lat', o.lat, 'lng', o.lng),
            'distance_m', round(p_distance), 'radius_m', coalesce(p_radius, 150))::text;
end;
$$;
revoke all on function public.refuse_off_site(uuid, double precision, double precision, text) from public, anon, authenticated;

-- Clock-ins. Runs after attendance_enforce and attendance_start_store
-- (BEFORE triggers fire in name order), so the store and distance are set.
create or replace function public.attendance_on_site_only()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type <> 'opening' or auth.uid() is null or auth.uid() <> new.user_id or not public.off_site_blocked() then
    return new;
  end if;
  if new.outlet_id is null or new.distance_m is null or new.accuracy_m > 100 then
    return new;
  end if;
  if public.too_far(new.distance_m, new.outlet_radius_m, new.accuracy_m) then
    perform public.refuse_off_site(new.outlet_id, new.distance_m, new.outlet_radius_m, 'clock in');
  end if;
  return new;
end;
$$;
revoke all on function public.attendance_on_site_only() from public, anon, authenticated;

drop trigger if exists trg_attendance_zx_on_site on public.attendance;
create trigger trg_attendance_zx_on_site
  before insert on public.attendance
  for each row when (not public.office_entry_on())
  execute function public.attendance_on_site_only();

-- Store check-ins. Runs after store_visit_enforce.
create or replace function public.store_visit_on_site_only()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  near record;
begin
  if auth.uid() is null or auth.uid() <> new.user_id or not public.off_site_blocked() then
    return new;
  end if;
  if new.arrived_accuracy_m > 100 then
    return new;
  end if;
  if new.outlet_id is not null then
    if new.arrived_distance_m is not null
       and public.too_far(new.arrived_distance_m, new.outlet_radius_m, new.arrived_accuracy_m) then
      perform public.refuse_off_site(new.outlet_id, new.arrived_distance_m, new.outlet_radius_m, 'check in');
    end if;
    return new;
  end if;
  -- Not in any of their stores: the nearest one, unless one of theirs is
  -- still waiting for its location (they may be standing in it).
  if public.has_allocated_stores(new.user_id)
     and not exists (select 1 from public.outlets x
                     where x.id in (select f.outlet_id from public.outlets_for_user(new.user_id) f)
                       and x.is_active and x.lat is null) then
    select x.id, x.geofence_radius_m,
           public.distance_metres(new.arrived_lat, new.arrived_lng, x.lat, x.lng) as d
      into near
    from public.outlets x
    where x.id in (select f.outlet_id from public.outlets_for_user(new.user_id) f)
      and x.is_active and x.lat is not null
    order by 3
    limit 1;
    if near.id is not null and public.too_far(near.d, near.geofence_radius_m, new.arrived_accuracy_m) then
      perform public.refuse_off_site(near.id, near.d, near.geofence_radius_m, 'check in');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.store_visit_on_site_only() from public, anon, authenticated;

drop trigger if exists trg_store_visit_on_site on public.store_visits;
create trigger trg_store_visit_on_site
  before insert on public.store_visits
  for each row when (not public.office_entry_on())
  execute function public.store_visit_on_site_only();

select 'On site only (0106) installed' as result;
