-- =====================================================================
-- 0074  Office stock count
--
-- An admin records a stock count (and expiries) from a prompt or a count
-- sheet, without the field GPS and photo gate. It is a real X Metrics count
-- (stock on hand, expiry alerts, reconciliation) and is recorded in the
-- admin's name, so it never counts towards a merchandiser's grade.
--
-- Field counts still carry GPS and a shelf photo; office counts do not, so
-- those columns become optional, kept required for field counts by a check.
-- =====================================================================

alter table public.xm_counts
  add column if not exists source text not null default 'field';
alter table public.xm_counts drop constraint if exists xm_counts_source_check;
alter table public.xm_counts
  add constraint xm_counts_source_check check (source in ('field', 'office'));

-- Office counts have no location or photo.
alter table public.xm_counts alter column lat drop not null;
alter table public.xm_counts alter column lng drop not null;
alter table public.xm_counts alter column accuracy_m drop not null;
alter table public.xm_counts alter column photo_path drop not null;

-- The column-level UNIQUE on photo_path cannot hold many null office rows;
-- replace it with a unique index over the photos that exist.
alter table public.xm_counts drop constraint if exists xm_counts_photo_path_key;
create unique index if not exists xm_counts_photo_path_uniq
  on public.xm_counts (photo_path) where photo_path is not null;

-- A field count must still bring its location and photo; an office count must
-- bring neither (and carries no distance).
alter table public.xm_counts drop constraint if exists xm_counts_source_shape_check;
alter table public.xm_counts add constraint xm_counts_source_shape_check check (
  case source
    when 'field' then lat is not null and lng is not null and accuracy_m is not null and photo_path is not null
    when 'office' then lat is null and lng is null and accuracy_m is null and distance_m is null and photo_path is null
    else false
  end
);

-- ---------------------------------------------------------------------
-- The office count itself. Admin only; the lines are checked the same way
-- a field count's are (products active, whole numbers, no repeat of a
-- product and batch). The feature guard (0063) still applies on insert.
-- ---------------------------------------------------------------------
create or replace function public.xm_office_count(p_outlet uuid, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  now_ts timestamptz := now();
  new_id uuid;
begin
  perform public.xm_require_admin();
  if not exists (select 1 from public.xm_stores where outlet_id = p_outlet and is_active) then
    raise exception 'That store is not in X Metrics yet';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Count at least one product';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'Too many lines in one count';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where not exists (select 1 from public.products p
                      where p.id::text = l->>'product_id' and p.is_active)
       or jsonb_typeof(l->'on_shelf') <> 'number' or jsonb_typeof(l->'in_backroom') <> 'number'
       or (l->>'on_shelf')::numeric <> trunc((l->>'on_shelf')::numeric)
       or (l->>'in_backroom')::numeric <> trunc((l->>'in_backroom')::numeric)
       or (l->>'on_shelf')::numeric not between 0 and 1000000
       or (l->>'in_backroom')::numeric not between 0 and 1000000
       or length(coalesce(l->>'batch', '')) > 60
  ) then
    raise exception 'Every line needs a product, and whole numbers from 0 up';
  end if;
  if (select count(distinct (l->>'product_id') || '|' || lower(btrim(coalesce(l->>'batch', ''))))
      from jsonb_array_elements(p_lines) l) <> jsonb_array_length(p_lines) then
    raise exception 'A product and batch appears twice in the count';
  end if;

  insert into public.xm_counts
    (outlet_id, user_id, count_date, captured_at, source, is_opening)
  values
    (p_outlet, auth.uid(), (now_ts at time zone 'Africa/Lagos')::date, now_ts, 'office',
     not exists (select 1 from public.xm_counts c where c.outlet_id = p_outlet and c.voided_at is null))
  returning id into new_id;

  insert into public.xm_count_lines (count_id, product_id, batch, expiry_date, on_shelf, in_backroom)
  select new_id, (l->>'product_id')::uuid, btrim(coalesce(l->>'batch', '')),
         nullif(l->>'expiry_date', '')::date,
         (l->>'on_shelf')::integer, (l->>'in_backroom')::integer
  from jsonb_array_elements(p_lines) l;

  return new_id;
end;
$$;
revoke all on function public.xm_office_count(uuid, jsonb) from public, anon;
grant execute on function public.xm_office_count(uuid, jsonb) to authenticated, service_role;
