-- =====================================================================
-- XTEND migration 019 — store counts
--
-- A merchandiser tells the office, product by product, how many units are
-- in their store and how many sold that day. The office keeps the product
-- list so everyone counts the same things under the same names.
--
-- The same shape as the rest of the app: the client sends only what was
-- counted; who counted it, for which day, and whether that store is
-- theirs is decided here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PRODUCTS: the list merchandisers count against. Admins keep it.
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 120),
  sku        text check (sku is null or length(sku) <= 60),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- One product per name, however it was capitalised or spaced.
create unique index if not exists products_name_unique
  on public.products (lower(btrim(name)));

alter table public.products enable row level security;

drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select using (auth.uid() is not null);

drop policy if exists products_admin on public.products;
create policy products_admin on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- STORE COUNTS: one row per person, store, product and day.
-- ---------------------------------------------------------------------
create table if not exists public.store_counts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete restrict,
  outlet_id  uuid not null references public.outlets(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  count_date date not null,
  in_store   integer not null check (in_store between 0 and 1000000),
  sold       integer not null check (sold between 0 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, outlet_id, product_id, count_date)
);

create index if not exists store_counts_by_date on public.store_counts (count_date);
create index if not exists store_counts_by_outlet on public.store_counts (outlet_id, count_date);

alter table public.store_counts enable row level security;

drop policy if exists store_counts_select on public.store_counts;
create policy store_counts_select on public.store_counts
  for select using (
    user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id)
  );

-- Writes go through submit_store_count() only, which is where the rules are.
revoke insert, update, delete, truncate on public.store_counts from anon, authenticated;

-- Who counts stock: the people who stand in a store, and admins.
create or replace function public.can_count_stock()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_active and role in ('merchandiser'::user_role, 'marketer'::user_role,
                                   'admin'::user_role)
     from public.profiles where id = auth.uid()),
    false);
$$;

revoke all on function public.can_count_stock() from public, anon;
grant execute on function public.can_count_stock() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Submits today's count for one store. p_lines is a JSON array of
-- {product_id, in_store, sold}. Sending a product again the same day
-- replaces the earlier figures; other days can no longer be changed.
-- ---------------------------------------------------------------------
create or replace function public.submit_store_count(p_outlet_id uuid, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  today date := public.business_date();
  saved integer;
begin
  if not public.can_count_stock() then
    raise exception 'You cannot submit a store count';
  end if;

  if p_outlet_id is null
     or p_outlet_id not in (select outlet_id from public.outlets_for_user(auth.uid())) then
    raise exception 'That store is not one of yours';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Count at least one product';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'Too many products in one count';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where jsonb_typeof(l->'in_store') <> 'number'
       or jsonb_typeof(l->'sold') <> 'number'
       or (l->>'in_store')::numeric <> trunc((l->>'in_store')::numeric)
       or (l->>'sold')::numeric <> trunc((l->>'sold')::numeric)
       or (l->>'in_store')::numeric not between 0 and 1000000
       or (l->>'sold')::numeric not between 0 and 1000000
  ) then
    raise exception 'Counts must be whole numbers from 0 up';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where not exists (
      select 1 from public.products p
      where p.id::text = l->>'product_id' and p.is_active
    )
  ) then
    raise exception 'One of those products is not on the list';
  end if;

  if (select count(distinct l->>'product_id') from jsonb_array_elements(p_lines) l)
     <> jsonb_array_length(p_lines) then
    raise exception 'A product appears twice in the count';
  end if;

  insert into public.store_counts (user_id, outlet_id, product_id, count_date, in_store, sold)
  select auth.uid(), p_outlet_id, (l->>'product_id')::uuid, today,
         (l->>'in_store')::integer, (l->>'sold')::integer
  from jsonb_array_elements(p_lines) l
  on conflict (user_id, outlet_id, product_id, count_date)
  do update set in_store   = excluded.in_store,
                sold       = excluded.sold,
                updated_at = now();

  get diagnostics saved = row_count;
  return saved;
end;
$$;

revoke all on function public.submit_store_count(uuid, jsonb) from public, anon;
grant execute on function public.submit_store_count(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- READ MODEL: counts with the names filled in. security_invoker, so the
-- table's RLS decides the rows.
-- ---------------------------------------------------------------------
create or replace view public.store_count_detail
with (security_invoker = true) as
  select
    c.id,
    c.count_date,
    c.user_id,
    p.full_name as staff_name,
    c.outlet_id,
    o.name      as outlet_name,
    c.product_id,
    pr.name     as product_name,
    pr.sku,
    c.in_store,
    c.sold,
    c.updated_at
  from public.store_counts c
  join public.profiles p  on p.id = c.user_id
  join public.outlets o   on o.id = c.outlet_id
  join public.products pr on pr.id = c.product_id;

grant select on public.store_count_detail to authenticated;
