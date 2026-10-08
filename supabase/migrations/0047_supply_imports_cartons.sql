-- =====================================================================
-- 0047: Supplies in cartons, and supplies imported from a file
--
-- A product can say how many units are in a carton. A supply can then be
-- logged in cartons: the units are worked out (cartons x units per carton)
-- and both are kept on the record, so reconciliation still counts units
-- and the delivery note's cartons can be checked against it.
--
-- Supplies can be read from a file (CSV, Excel, a PDF or Word invoice) and
-- logged together after an admin has checked them. Each import is kept:
-- the file's name, what was read from it, who imported it, and which
-- supplies it logged.
-- =====================================================================

alter table public.products add column if not exists units_per_carton integer
  check (units_per_carton is null or units_per_carton between 1 and 100000);

create table if not exists public.xm_supply_imports (
  id            uuid primary key default gen_random_uuid(),
  file_name     text not null check (length(btrim(file_name)) between 1 and 200),
  file_kind     text not null check (file_kind in ('csv', 'xlsx', 'pdf', 'docx')),
  read_by       text not null check (read_by in ('table', 'claude')),
  supplier      text check (supplier is null or length(supplier) <= 200),
  invoice_no    text check (invoice_no is null or length(invoice_no) <= 100),
  invoice_date  date,
  rows_found    integer not null default 0 check (rows_found >= 0),
  rows_logged   integer not null default 0 check (rows_logged >= 0),
  created_by    uuid not null references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default clock_timestamp()
);

alter table public.xm_supplies add column if not exists cartons integer
  check (cartons is null or cartons between 1 and 100000);
alter table public.xm_supplies add column if not exists units_per_carton integer
  check (units_per_carton is null or units_per_carton between 1 and 100000);
alter table public.xm_supplies add column if not exists import_id uuid
  references public.xm_supply_imports(id) on delete restrict;

alter table public.xm_supply_imports enable row level security;
drop policy if exists xm_supply_imports_read on public.xm_supply_imports;
create policy xm_supply_imports_read on public.xm_supply_imports for select using (public.is_admin());
revoke insert, update, delete, truncate on public.xm_supply_imports from anon, authenticated;

-- One supply, in units or in cartons. In cartons, the units per carton
-- come from the call or the product; a product that has none yet learns
-- it from the first supply that says.
drop function if exists public.xm_log_supply(uuid, uuid, integer, text, date, date, text);
create or replace function public.xm_log_supply(
  p_outlet uuid, p_product uuid, p_quantity integer, p_batch text,
  p_expiry date, p_supplied_on date, p_note text,
  p_cartons integer default null, p_units_per_carton integer default null, p_import uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  prod record;
  per integer;
  units integer;
begin
  perform public.xm_require_admin();
  if not exists (select 1 from public.xm_stores where outlet_id = p_outlet and is_active) then
    raise exception 'Add the store to X Metrics first';
  end if;
  select id, name, units_per_carton into prod from public.products where id = p_product and is_active;
  if prod.id is null then
    raise exception 'That product does not exist or is retired';
  end if;
  if p_supplied_on is null or p_supplied_on > public.business_date() then
    raise exception 'The supply date cannot be in the future';
  end if;
  if p_expiry is not null and p_expiry < p_supplied_on then
    raise exception 'The expiry date is before the supply date';
  end if;

  if p_cartons is not null then
    if p_cartons < 1 or p_cartons > 100000 then
      raise exception 'Cartons must be a whole number from 1';
    end if;
    per := coalesce(p_units_per_carton, prod.units_per_carton);
    if per is null then
      raise exception 'Say how many units are in a carton of %', prod.name;
    end if;
    if per < 1 or per > 100000 then
      raise exception 'Units per carton must be a whole number from 1';
    end if;
    units := p_cartons * per;
    if prod.units_per_carton is null then
      update public.products set units_per_carton = per where id = prod.id;
    end if;
  else
    units := p_quantity;
  end if;
  if units is null or units < 1 or units > 1000000 then
    raise exception 'The quantity must be between 1 and 1,000,000 units';
  end if;

  insert into public.xm_supplies
    (outlet_id, product_id, quantity, batch, expiry_date, supplied_on, note, logged_by,
     cartons, units_per_carton, import_id)
  values (p_outlet, p_product, units, btrim(coalesce(p_batch, '')), p_expiry, p_supplied_on,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
          p_cartons, case when p_cartons is not null then per end, p_import)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.xm_log_supply(uuid, uuid, integer, text, date, date, text, integer, integer, uuid)
  from public, anon;
grant execute on function public.xm_log_supply(uuid, uuid, integer, text, date, date, text, integer, integer, uuid)
  to authenticated, service_role;

-- An import is recorded when the file is read, before anything is logged.
create or replace function public.xm_create_supply_import(
  p_file_name text, p_kind text, p_read_by text, p_supplier text, p_invoice_no text,
  p_invoice_date date, p_rows integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  perform public.xm_require_admin();
  insert into public.xm_supply_imports
    (file_name, file_kind, read_by, supplier, invoice_no, invoice_date, rows_found, created_by)
  values (left(btrim(p_file_name), 200), p_kind, p_read_by, left(nullif(btrim(coalesce(p_supplier, '')), ''), 200),
          left(nullif(btrim(coalesce(p_invoice_no, '')), ''), 100), p_invoice_date, greatest(coalesce(p_rows, 0), 0),
          auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.xm_create_supply_import(text, text, text, text, text, date, integer) from public, anon;
grant execute on function public.xm_create_supply_import(text, text, text, text, text, date, integer)
  to authenticated, service_role;

-- Logs the checked lines of an import, all or none: a line that cannot be
-- logged stops the lot, and says which line.
create or replace function public.xm_log_supply_import(p_import uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  i integer := 0;
begin
  perform public.xm_require_admin();
  if not exists (select 1 from public.xm_supply_imports where id = p_import) then
    raise exception 'That import does not exist';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Choose at least one line to log';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Log at most 500 lines at a time';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      perform public.xm_log_supply(
        (r->>'outlet_id')::uuid, (r->>'product_id')::uuid,
        nullif(r->>'quantity', '')::integer, r->>'batch',
        nullif(r->>'expiry_date', '')::date, (r->>'supplied_on')::date, r->>'note',
        nullif(r->>'cartons', '')::integer, nullif(r->>'units_per_carton', '')::integer, p_import);
    exception when others then
      raise exception 'Line %: %', i, sqlerrm;
    end;
  end loop;
  update public.xm_supply_imports set rows_logged = rows_logged + i where id = p_import;
  return i;
end;
$$;
revoke all on function public.xm_log_supply_import(uuid, jsonb) from public, anon;
grant execute on function public.xm_log_supply_import(uuid, jsonb) to authenticated, service_role;

-- The supplies view picks up the new columns, and the import's file.
drop view if exists public.xm_supply_detail;
create view public.xm_supply_detail
with (security_invoker = true) as
  select s.*, o.name as outlet_name, p.name as product_name, p.sku, p.unit,
         lb.full_name as logged_by_name, vb.full_name as voided_by_name,
         i.file_name as import_file
  from public.xm_supplies s
  join public.outlets o on o.id = s.outlet_id
  join public.products p on p.id = s.product_id
  left join public.profiles lb on lb.id = s.logged_by
  left join public.profiles vb on vb.id = s.voided_by
  left join public.xm_supply_imports i on i.id = s.import_id;
grant select on public.xm_supply_detail to authenticated;

select 'Supplies in cartons and imports (047) installed' as result;
