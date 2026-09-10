-- =====================================================================
-- XTEND migration 008 — the name of the place, not just its coordinates
--
-- attendance.address already held whatever the geocoder returned. The name
-- of the premises is a separate fact from its street address, and the
-- dashboard wants to lead with it ("Justrite Superstore Bariga"), so it is
-- stored in its own column along with which source produced it.
-- =====================================================================

alter table public.attendance add column if not exists place_name text;
alter table public.attendance add column if not exists place_source text;

comment on column public.attendance.place_name is
  'Business or landmark at the captured coordinates, when one was identified.';
comment on column public.attendance.place_source is
  'outlet | google | osm | coordinates — where place_name and address came from.';

-- The read model the dashboard and exports use.
-- Dropped rather than replaced: CREATE OR REPLACE VIEW cannot insert a
-- column into the middle of the existing list.
drop view if exists public.attendance_detail;
create view public.attendance_detail
with (security_invoker = true) as
  select
    a.id,
    a.user_id,
    p.full_name        as staff_name,
    p.phone            as staff_phone,
    a.attendance_date,
    a.type,
    a.created_at,
    to_char(a.created_at at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI') as local_time,
    a.outlet_id,
    o.name             as outlet_name,
    o.shift_start,
    o.shift_end,
    a.address,
    a.place_name,
    a.place_source,
    -- What to show as "where they were": the premises name and the street,
    -- falling back to the address alone and then to the coordinates.
    coalesce(
      nullif(trim(both ', ' from concat_ws(', ', a.place_name, nullif(a.address, a.place_name))), ''),
      a.address,
      round(a.lat::numeric, 5) || ', ' || round(a.lng::numeric, 5)
    ) as location_label,
    a.lat,
    a.lng,
    a.accuracy_m,
    a.distance_m,
    a.outlet_lat,
    a.outlet_lng,
    a.outlet_radius_m,
    a.status,
    a.selfie_path,
    a.thumb_path,
    a.device_info,
    a.client_captured_at,
    case
      when a.type = 'opening' and o.shift_start is not null
       and (a.created_at at time zone 'Africa/Lagos')::time > o.shift_start
      then true else false
    end as is_late
  from public.attendance a
  join public.profiles p on p.id = a.user_id
  left join public.outlets o on o.id = a.outlet_id;
