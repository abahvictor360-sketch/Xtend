-- =====================================================================
-- XTEND migration 014 — check in without naming the store
--
-- Asking a marketer which shop they are standing in is asking a question
-- the phone can already answer, and answering it wrongly is the one thing
-- that gets somebody wrongly marked off site. The list also gets long once
-- a round covers a dozen stores.
--
-- So outlet_id becomes optional on the way in. Left out, the trigger picks
-- whichever of the person's own stores they are closest to. The column
-- stays NOT NULL — a BEFORE trigger fills it before the constraint is
-- checked — so nothing downstream has to cope with a visit to nowhere.
--
-- Picking the nearest is deliberately unconditional. Someone checking in
-- two kilometres from every store they have still gets a visit recorded,
-- against the nearest one, marked off_site with the distance and an alert
-- — which is exactly what the office needs to see. Refusing the check-in
-- would leave no record of it at all.
-- =====================================================================

create or replace function public.nearest_outlet_for_user(
  target uuid,
  p_lat double precision,
  p_lng double precision
)
returns uuid
language sql stable security definer set search_path = public as $$
  select o.id
  from public.outlets o
  where o.id in (select outlet_id from public.outlets_for_user(target))
  order by public.distance_metres(p_lat, p_lng, o.lat, o.lng)
  limit 1;
$$;

revoke all on function public.nearest_outlet_for_user(uuid, double precision, double precision)
  from public, anon;
grant execute on function public.nearest_outlet_for_user(uuid, double precision, double precision)
  to authenticated, service_role;

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

  -- No store named: use the one they are standing closest to.
  if new.outlet_id is null then
    new.outlet_id :=
      public.nearest_outlet_for_user(new.user_id, new.arrived_lat, new.arrived_lng);
    if new.outlet_id is null then
      raise exception 'You have no stores allocated. Ask your supervisor to add some.';
    end if;
  end if;

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

revoke all on function public.store_visit_enforce() from public, anon, authenticated;
