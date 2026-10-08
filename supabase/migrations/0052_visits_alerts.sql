-- =====================================================================
-- XTEND migration 052 — store visits and alerts, advanced
--
-- Three things the office asked for on the Store visits and Alerts pages:
--
--   1. Where somebody was when they checked OUT of a store, not just in.
--      The departure was always recorded (010); the read model never
--      showed it. It also lets the page notice two visits back to back
--      that are too far apart for anybody to have travelled between.
--   2. Store coverage: every store with its last visit, so a supervisor
--      can see which shops nobody has been to in a week, two, or a month.
--   3. Resolving several alerts at once with one note, in one
--      transaction, each still audited on its own row.
--
-- Nothing here widens who sees what: both views run as the caller
-- (security_invoker), so a supervisor sees their own team's visits and
-- the stores that team covers, exactly as before.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. store_visit_detail gains the departure and the store's own point.
--    Same columns as 016 in the same order, new ones on the end, so
--    CREATE OR REPLACE keeps the functions that return this row type.
-- ---------------------------------------------------------------------
create or replace view public.store_visit_detail
with (security_invoker = true) as
  select
    v.id,
    v.user_id,
    p.full_name as staff_name,
    p.phone     as staff_phone,
    v.outlet_id,
    o.name      as outlet_name,
    o.address   as outlet_address,
    v.visit_date,
    v.status,
    v.arrived_at,
    v.departed_at,
    case
      when v.departed_at is null
        then (extract(epoch from (now() - v.arrived_at)) / 60)::int
      else (extract(epoch from (v.departed_at - v.arrived_at)) / 60)::int
    end as minutes,
    v.arrived_status,
    v.departed_status,
    round(v.arrived_distance_m)::int  as arrived_distance_m,
    round(v.departed_distance_m)::int as departed_distance_m,
    v.arrived_accuracy_m,
    v.arrived_lat,
    v.arrived_lng,
    v.outlet_radius_m,
    v.selfie_path,
    v.thumb_path,
    coalesce(
      nullif(trim(both ', ' from concat_ws(', ', v.arrived_place_name,
        nullif(v.arrived_address, v.arrived_place_name))), ''),
      v.arrived_address,
      round(v.arrived_lat::numeric, 5) || ', ' || round(v.arrived_lng::numeric, 5)
    ) as arrived_label,
    v.arrived_place_name,
    v.arrived_address,
    coalesce(
      case when v.arrived_status = 'on_site' then o.name end,
      nullif(v.arrived_place_name, ''),
      nullif(v.arrived_address, ''),
      o.name,
      'Unnamed place'
    ) as store_label,
    case
      when v.arrived_status = 'on_site' and o.name is not null then 'outlet'
      when coalesce(nullif(v.arrived_place_name, ''), nullif(v.arrived_address, '')) is not null
        then 'map'
      else 'outlet'
    end as store_label_source,
    -- New in 052: the way out.
    v.departed_lat,
    v.departed_lng,
    v.departed_accuracy_m,
    coalesce(
      nullif(trim(both ', ' from concat_ws(', ', v.departed_place_name,
        nullif(v.departed_address, v.departed_place_name))), ''),
      v.departed_address,
      case
        when v.departed_lat is not null
        then round(v.departed_lat::numeric, 5) || ', ' || round(v.departed_lng::numeric, 5)
      end
    ) as departed_label,
    v.outlet_lat,
    v.outlet_lng
  from public.store_visits v
  join public.profiles p on p.id = v.user_id
  left join public.outlets o on o.id = v.outlet_id;

-- ---------------------------------------------------------------------
-- 2. Store coverage: one row per store, with its last visit.
--
-- staff_assigned counts the active field staff the caller can see who
-- have the store as their home or among their allocated stores, so a
-- supervisor can keep to the stores their team covers. visits_30d and
-- the last visit are the caller's visible visits only.
-- ---------------------------------------------------------------------
create or replace view public.store_coverage
with (security_invoker = true) as
  select
    o.id   as outlet_id,
    o.name,
    o.address,
    o.lat,
    o.lng,
    o.is_active,
    (
      select count(distinct pr.id)::int
      from public.profiles pr
      where pr.is_active
        and public.is_field_role(pr.role)
        and (pr.outlet_id = o.id
             or exists (select 1 from public.staff_outlets s
                        where s.user_id = pr.id and s.outlet_id = o.id))
    ) as staff_assigned,
    last.arrived_at as last_visit_at,
    last.visit_date as last_visit_date,
    last.user_id    as last_visit_user_id,
    last.full_name  as last_visit_by,
    (
      select count(*)::int
      from public.store_visits v
      where v.outlet_id = o.id
        and v.visit_date >= public.business_date() - 29
    ) as visits_30d
  from public.outlets o
  left join lateral (
    select v.arrived_at, v.visit_date, v.user_id, p.full_name
    from public.store_visits v
    join public.profiles p on p.id = v.user_id
    where v.outlet_id = o.id
    order by v.arrived_at desc
    limit 1
  ) last on true;

grant select on public.store_coverage to authenticated;

create index if not exists store_visits_by_outlet_arrival
  on public.store_visits (outlet_id, arrived_at desc);

-- ---------------------------------------------------------------------
-- 3. Resolve several alerts with one note. Admin only, like
--    resolve_alert (002). Alerts already resolved are left alone, so
--    two people clearing the same list cannot overwrite each other's
--    notes. One audit row per alert, as if each had been resolved alone.
-- ---------------------------------------------------------------------
create or replace function public.resolve_alerts(p_alert_ids uuid[], p_note text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  done uuid;
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  if coalesce(array_length(p_alert_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_alert_ids, 1) > 500 then
    raise exception 'Resolve at most 500 alerts at a time';
  end if;

  for done in
    update public.location_alerts
    set is_resolved = true,
        resolved_by = auth.uid(),
        resolved_at = now(),
        note        = p_note
    where id = any(p_alert_ids) and not is_resolved
    returning id
  loop
    perform public.write_audit(
      'alert.resolve', 'location_alerts', done,
      jsonb_build_object('note', p_note, 'together_with', array_length(p_alert_ids, 1))
    );
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.resolve_alerts(uuid[], text) from public, anon;
grant execute on function public.resolve_alerts(uuid[], text) to authenticated, service_role;

select 'Store visits and alerts (052) installed' as result;
