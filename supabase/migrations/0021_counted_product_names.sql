-- =====================================================================
-- XTEND migration 021 — merchandisers name the products they count
--
-- There is no product list for the office to keep. A merchandiser counts
-- what is physically in the store and types each product's name, how many
-- are left, and how many were sold. The names still become rows in
-- public.products, created on first use, so that "Xpel Lotion 400ml" and
-- "xpel lotion  400ML" land on the same product and totals add up.
--
-- submit_store_count() keeps its signature; each line is now
-- {product_name, in_store, sold}. in_store is what is left in the store.
-- =====================================================================

-- A product name the way it is compared: trimmed, single-spaced, lower case.
create or replace function public.product_key(p_name text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$$;

create or replace function public.submit_store_count(p_outlet_id uuid, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  today date := public.business_date();
  status jsonb := public.store_count_status();
  req uuid := nullif(status->>'request_id', '')::uuid;
  saved integer;
begin
  if not public.can_count_stock() then
    raise exception 'You cannot submit a store count';
  end if;

  if not coalesce((status->>'open')::boolean, false) then
    raise exception 'No store count is due: counts are taken when a supervisor asks, or at the end of the month';
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
    where length(public.product_key(l->>'product_name')) not between 1 and 120
  ) then
    raise exception 'Every product needs a name of up to 120 characters';
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

  if (select count(distinct public.product_key(l->>'product_name'))
      from jsonb_array_elements(p_lines) l) <> jsonb_array_length(p_lines) then
    raise exception 'A product appears twice in the count';
  end if;

  -- New names become products; known names, however they are typed, reuse theirs.
  insert into public.products (name)
  select distinct on (public.product_key(l->>'product_name'))
         regexp_replace(btrim(l->>'product_name'), '\s+', ' ', 'g')
  from jsonb_array_elements(p_lines) l
  where not exists (
    select 1 from public.products p
    where lower(btrim(p.name)) = public.product_key(l->>'product_name')
       or public.product_key(p.name) = public.product_key(l->>'product_name')
  )
  on conflict do nothing;

  insert into public.store_counts
    (user_id, outlet_id, product_id, count_date, in_store, sold, request_id)
  select auth.uid(), p_outlet_id,
         (select p.id from public.products p
          where public.product_key(p.name) = public.product_key(l->>'product_name')
          order by p.created_at limit 1),
         today, (l->>'in_store')::integer, (l->>'sold')::integer, req
  from jsonb_array_elements(p_lines) l
  on conflict (user_id, outlet_id, product_id, count_date)
  do update set in_store   = excluded.in_store,
                sold       = excluded.sold,
                request_id = excluded.request_id,
                updated_at = now();

  get diagnostics saved = row_count;
  return saved;
end;
$$;

-- The names already counted, for the phone to suggest while typing.
create or replace function public.counted_product_names()
returns table (name text)
language sql stable security definer set search_path = public as $$
  select p.name from public.products p
  where public.can_count_stock() or public.is_admin()
  order by p.name
  limit 2000;
$$;

revoke all on function public.counted_product_names() from public, anon;
grant execute on function public.counted_product_names() to authenticated, service_role;

select 'Store count update 021 installed' as result;
