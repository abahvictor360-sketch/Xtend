-- =====================================================================
-- XTEND migration 015 — let the map name the store
--
-- A marketer who checks in somewhere that is not one of their own stores
-- was described entirely in terms of a store they were nowhere near:
-- "Ikeja City Mall, 14,088 m off site". The distance is the right thing
-- to record, but it is the wrong thing to lead with, because the map
-- already knows what building they are actually standing in.
--
-- So the visit now carries a store label that says where they are:
--
--   inside one of their own fences -> the outlet's own name, which is
--     the most reliable answer there is and costs no lookup
--   anywhere else -> the premises the map names, falling back to the
--     street, and only then to the outlet the distance was measured from
--
-- Nothing about the checking changes. The status is still decided by the
-- geofence, an arrival away from the store still raises the same alert,
-- and a visit is still measured against the nearest of the person's own
-- stores. This is what the office reads, not what it enforces.
-- =====================================================================

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
    -- The store as a human would name it, standing there.
    case
      when v.arrived_status = 'on_site' then o.name
      else coalesce(nullif(v.arrived_place_name, ''), nullif(v.arrived_address, ''), o.name)
    end as store_label,
    -- Whether that name came from the outlet record or from the map.
    case
      when v.arrived_status = 'on_site' then 'outlet'
      when coalesce(nullif(v.arrived_place_name, ''), nullif(v.arrived_address, '')) is null
        then 'outlet'
      else 'map'
    end as store_label_source
  from public.store_visits v
  join public.profiles p on p.id = v.user_id
  join public.outlets o on o.id = v.outlet_id;
