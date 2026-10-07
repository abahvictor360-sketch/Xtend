-- =====================================================================
-- XTEND migration 043 — X Metrics
--
-- Field staff who already clock in with Xtend become the source for
-- stock, sales and expiry, and are graded monthly on it. Everything
-- plugs into what is there: profiles and their roles, outlets and who is
-- allocated to them (outlets_for_user), photo checks (023), integrity
-- flags and their pushes to supervisors (022, 036), attendance.
--
--   * Products gain a category and a unit (the catalogue is the existing
--     products table).
--   * A store joins X Metrics (xm_stores); its first stock count there is
--     the opening baseline.
--   * Admins log supplies; staff submit stock counts (by batch, with
--     expiry, shelf and backroom, a photo and their location) and daily
--     sales (with a photo). Admins set monthly targets.
--   * Reconciliation: expected = last count + supplied since - sold
--     since, against the new count, per store and product. A gap beyond
--     the tolerance raises a stock_discrepancy flag on the person who
--     counted, which the existing alerts push to admins and supervisors.
--   * Expiry: every batch on hand is watched against the alert windows,
--     and set against how fast it sells: near expiry and slow to sell is
--     "consider pulling".
--   * Grading: sales against target, stock accuracy, reporting
--     consistency (drawn against attendance) and expiry handling,
--     weighted, banded, and kept once a month is finalised.
--
-- Auditable: every supply, count and sale records who and when, and is
-- never changed. A mistake is voided (who, when, why) and entered again;
-- a day's sales sent again supersede the earlier version, which is kept.
-- Tolerance, weights, bands and alert windows are settings, not code.
-- =====================================================================

do $$
begin
  if to_regclass('public.products') is null or to_regclass('public.integrity_flags') is null then
    raise exception 'Run the store count and integrity updates (019 to 036) first, then this file';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Products: the existing catalogue, with what X Metrics needs.
-- ---------------------------------------------------------------------
alter table public.products add column if not exists category text
  check (category is null or length(btrim(category)) between 1 and 60);
alter table public.products add column if not exists unit text not null default 'unit'
  check (length(btrim(unit)) between 1 and 30);
create unique index if not exists products_sku_unique
  on public.products (lower(btrim(sku))) where sku is not null;

-- ---------------------------------------------------------------------
-- Settings: one row, changed by admins, every version kept.
-- ---------------------------------------------------------------------
create table if not exists public.xm_settings (
  id                   boolean primary key default true check (id),
  tolerance_pct        numeric(5,2) not null default 5 check (tolerance_pct between 0 and 100),
  weight_sales         integer not null default 40 check (weight_sales between 0 and 100),
  weight_accuracy      integer not null default 30 check (weight_accuracy between 0 and 100),
  weight_consistency   integer not null default 20 check (weight_consistency between 0 and 100),
  weight_expiry        integer not null default 10 check (weight_expiry between 0 and 100),
  band_poor_below      integer not null default 40 check (band_poor_below between 1 and 99),
  band_strong_from     integer not null default 70 check (band_strong_from between 2 and 100),
  alert_windows_days   integer[] not null default '{730,365,180,90,30}',
  velocity_days        integer not null default 30 check (velocity_days between 7 and 365),
  count_interval_days  integer not null default 7 check (count_interval_days between 1 and 31),
  sales_grace_hours    integer not null default 12 check (sales_grace_hours between 0 and 72),
  sales_photo_required boolean not null default true,
  updated_by           uuid references public.profiles(id) on delete set null,
  updated_at           timestamptz not null default now(),
  constraint xm_settings_weights check (weight_sales + weight_accuracy + weight_consistency + weight_expiry = 100),
  constraint xm_settings_bands check (band_poor_below < band_strong_from),
  constraint xm_settings_windows check (
    cardinality(alert_windows_days) between 1 and 10
    and 0 < all(alert_windows_days) and 3650 >= all(alert_windows_days))
);
insert into public.xm_settings (id) values (true) on conflict do nothing;

create table if not exists public.xm_settings_history (
  id          bigint generated always as identity primary key,
  settings    jsonb not null,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);

create or replace function public.xm_settings_keep()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  insert into public.xm_settings_history (settings, changed_by) values (to_jsonb(old), auth.uid());
  return new;
end;
$$;
drop trigger if exists trg_xm_settings_keep on public.xm_settings;
create trigger trg_xm_settings_keep before update on public.xm_settings
  for each row execute function public.xm_settings_keep();

-- ---------------------------------------------------------------------
-- Stores in X Metrics.
-- ---------------------------------------------------------------------
create table if not exists public.xm_stores (
  outlet_id    uuid primary key references public.outlets(id) on delete restrict,
  enrolled_at  timestamptz not null default now(),
  enrolled_by  uuid references public.profiles(id) on delete set null,
  is_active    boolean not null default true
);

-- ---------------------------------------------------------------------
-- Supplies, logged by an admin. The source of truth for what was sent.
-- ---------------------------------------------------------------------
create table if not exists public.xm_supplies (
  id           uuid primary key default gen_random_uuid(),
  outlet_id    uuid not null references public.outlets(id) on delete restrict,
  product_id   uuid not null references public.products(id) on delete restrict,
  quantity     integer not null check (quantity between 1 and 1000000),
  batch        text not null default '' check (length(batch) <= 60),
  expiry_date  date,
  supplied_on  date not null,
  note         text check (note is null or length(note) <= 500),
  logged_by    uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default clock_timestamp(),
  voided_at    timestamptz,
  voided_by    uuid references public.profiles(id) on delete set null,
  void_reason  text check (void_reason is null or length(btrim(void_reason)) between 3 and 300)
);
create index if not exists xm_supplies_by_store on public.xm_supplies (outlet_id, product_id, supplied_on);

-- ---------------------------------------------------------------------
-- Stock counts: one per store visit, a line per product and batch.
-- ---------------------------------------------------------------------
create table if not exists public.xm_counts (
  id             uuid primary key default gen_random_uuid(),
  outlet_id      uuid not null references public.outlets(id) on delete restrict,
  user_id        uuid not null references public.profiles(id) on delete restrict,
  count_date     date not null,
  captured_at    timestamptz not null,
  created_at     timestamptz not null default clock_timestamp(),
  lat            double precision not null,
  lng            double precision not null,
  accuracy_m     double precision not null,
  distance_m     double precision,
  photo_path     text not null unique,
  is_opening     boolean not null default false,
  reconciled_at  timestamptz,
  voided_at      timestamptz,
  voided_by      uuid references public.profiles(id) on delete set null,
  void_reason    text check (void_reason is null or length(btrim(void_reason)) between 3 and 300)
);
create index if not exists xm_counts_by_store on public.xm_counts (outlet_id, count_date, created_at);
create index if not exists xm_counts_by_user on public.xm_counts (user_id, count_date);

create table if not exists public.xm_count_lines (
  id           uuid primary key default gen_random_uuid(),
  count_id     uuid not null references public.xm_counts(id) on delete restrict,
  product_id   uuid not null references public.products(id) on delete restrict,
  batch        text not null default '' check (length(batch) <= 60),
  expiry_date  date,
  on_shelf     integer not null check (on_shelf between 0 and 1000000),
  in_backroom  integer not null check (in_backroom between 0 and 1000000),
  unique (count_id, product_id, batch)
);
create index if not exists xm_count_lines_by_product on public.xm_count_lines (product_id);

-- ---------------------------------------------------------------------
-- Daily sales: one report per person, store and day. Sending the day
-- again supersedes the earlier version; nothing is overwritten.
-- ---------------------------------------------------------------------
create table if not exists public.xm_sales (
  id             uuid primary key default gen_random_uuid(),
  outlet_id      uuid not null references public.outlets(id) on delete restrict,
  user_id        uuid not null references public.profiles(id) on delete restrict,
  sale_date      date not null,
  captured_at    timestamptz not null,
  created_at     timestamptz not null default clock_timestamp(),
  photo_path     text unique,
  superseded_by  uuid references public.xm_sales(id) on delete restrict,
  voided_at      timestamptz,
  voided_by      uuid references public.profiles(id) on delete set null,
  void_reason    text check (void_reason is null or length(btrim(void_reason)) between 3 and 300)
);
create index if not exists xm_sales_by_store on public.xm_sales (outlet_id, sale_date);
create index if not exists xm_sales_by_user on public.xm_sales (user_id, sale_date);

create table if not exists public.xm_sale_lines (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.xm_sales(id) on delete restrict,
  product_id  uuid not null references public.products(id) on delete restrict,
  units       integer not null check (units between 0 and 1000000),
  unique (sale_id, product_id)
);

-- The sales that count: the latest version, not voided.
create or replace view public.xm_live_sale_lines
with (security_invoker = true) as
  select s.id as sale_id, s.outlet_id, s.user_id, s.sale_date, s.created_at, l.product_id, l.units
  from public.xm_sales s
  join public.xm_sale_lines l on l.sale_id = s.id
  where s.superseded_by is null and s.voided_at is null;

-- ---------------------------------------------------------------------
-- Monthly targets, per person or per store. The newest for a month wins;
-- the earlier ones are kept. Times are clock_timestamp() so two set in
-- one transaction still order.
-- ---------------------------------------------------------------------
create table if not exists public.xm_targets (
  id            uuid primary key default gen_random_uuid(),
  month         date not null check (month = date_trunc('month', month)::date),
  user_id       uuid references public.profiles(id) on delete restrict,
  outlet_id     uuid references public.outlets(id) on delete restrict,
  target_units  integer not null check (target_units between 1 and 100000000),
  set_by        uuid not null references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default clock_timestamp(),
  constraint xm_targets_one_subject check ((user_id is null) <> (outlet_id is null))
);
create index if not exists xm_targets_by_month on public.xm_targets (month);

create or replace view public.xm_current_targets
with (security_invoker = true) as
  select distinct on (t.month, t.user_id, t.outlet_id)
         t.id, t.month, t.user_id, t.outlet_id, t.target_units, t.set_by, t.created_at
  from public.xm_targets t
  order by t.month, t.user_id, t.outlet_id, t.created_at desc;

-- ---------------------------------------------------------------------
-- Reconciliation results, one per count and product. Written once.
-- ---------------------------------------------------------------------
create table if not exists public.xm_reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  count_id           uuid not null references public.xm_counts(id) on delete restrict,
  product_id         uuid not null references public.products(id) on delete restrict,
  previous_count_id  uuid not null references public.xm_counts(id) on delete restrict,
  previous_units     integer not null,
  supplied_units     integer not null,
  sold_units         integer not null,
  expected_units     integer not null,
  actual_units       integer not null,
  variance_units     integer not null,
  variance_pct       numeric(8,2) not null,
  tolerance_pct      numeric(5,2) not null,
  flagged            boolean not null,
  flag_id            uuid references public.integrity_flags(id) on delete set null,
  computed_at        timestamptz not null default now(),
  unique (count_id, product_id)
);

-- ---------------------------------------------------------------------
-- Expiry alerts: one per batch and window crossed.
-- ---------------------------------------------------------------------
create table if not exists public.xm_expiry_alerts (
  id                uuid primary key default gen_random_uuid(),
  outlet_id         uuid not null references public.outlets(id) on delete restrict,
  product_id        uuid not null references public.products(id) on delete restrict,
  batch             text not null default '',
  expiry_date       date not null,
  window_days       integer not null,
  days_left         integer not null,
  units_on_hand     integer not null,
  daily_velocity    numeric(10,3) not null,
  days_to_sell      numeric(10,1),
  consider_pulling  boolean not null,
  count_id          uuid references public.xm_counts(id) on delete set null,
  created_at        timestamptz not null default clock_timestamp(),
  notified_at       timestamptz,
  acknowledged_at   timestamptz,
  acknowledged_by   uuid references public.profiles(id) on delete set null,
  note              text check (note is null or length(note) <= 500),
  unique (outlet_id, product_id, batch, expiry_date, window_days)
);

-- ---------------------------------------------------------------------
-- Monthly grades, kept once a month is finalised.
-- ---------------------------------------------------------------------
create table if not exists public.xm_monthly_grades (
  id            uuid primary key default gen_random_uuid(),
  month         date not null check (month = date_trunc('month', month)::date),
  user_id       uuid not null references public.profiles(id) on delete restrict,
  grade         jsonb not null,
  score         numeric(5,1),
  band          text check (band in ('Poor', 'Average', 'Strong')),
  finalised_at  timestamptz not null default now(),
  finalised_by  uuid references public.profiles(id) on delete set null,
  review_note   text check (review_note is null or length(review_note) <= 1000),
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  unique (month, user_id)
);

-- ---------------------------------------------------------------------
-- Discrepancies are integrity flags, so they reach admins and supervisors
-- the way every other flag does (036).
-- ---------------------------------------------------------------------
alter table public.integrity_flags drop constraint if exists integrity_flags_kind_check;
alter table public.integrity_flags add constraint integrity_flags_kind_check check (kind in (
  'repeated_exact_location', 'perfect_accuracy', 'impossible_journey',
  'count_units_missing', 'count_identical', 'count_round_numbers',
  'photo_rejected', 'photo_unchecked', 'own_named_place', 'selfie_at_home',
  'backdated_clock', 'phone_clock_wrong', 'late_sync_with_network',
  'vpn_suspected', 'ip_location_mismatch', 'timezone_mismatch', 'gps_mock_fingerprint',
  'mock_location_confirmed', 'device_integrity_failed',
  'late_clock_in', 'early_clock_out',
  'stock_discrepancy'));

-- =====================================================================
-- ACCESS
-- Staff read their own counts and sales; admins everything; supervisors
-- their team's. Writes go through the functions below only.
-- =====================================================================
alter table public.xm_settings enable row level security;
alter table public.xm_settings_history enable row level security;
alter table public.xm_stores enable row level security;
alter table public.xm_supplies enable row level security;
alter table public.xm_counts enable row level security;
alter table public.xm_count_lines enable row level security;
alter table public.xm_sales enable row level security;
alter table public.xm_sale_lines enable row level security;
alter table public.xm_targets enable row level security;
alter table public.xm_reconciliations enable row level security;
alter table public.xm_expiry_alerts enable row level security;
alter table public.xm_monthly_grades enable row level security;

-- Who oversees a store: an admin, or a supervisor of anyone allocated to it.
create or replace function public.xm_oversees_outlet(p_outlet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p
    where public.supervises_user(p.id)
      and p_outlet in (select outlet_id from public.outlets_for_user(p.id))
  );
$$;
revoke all on function public.xm_oversees_outlet(uuid) from public, anon;
grant execute on function public.xm_oversees_outlet(uuid) to authenticated, service_role;

drop policy if exists xm_settings_read on public.xm_settings;
create policy xm_settings_read on public.xm_settings for select using (auth.uid() is not null);
drop policy if exists xm_settings_admin on public.xm_settings;
create policy xm_settings_admin on public.xm_settings for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists xm_settings_history_read on public.xm_settings_history;
create policy xm_settings_history_read on public.xm_settings_history for select using (public.is_admin());

drop policy if exists xm_stores_read on public.xm_stores;
create policy xm_stores_read on public.xm_stores for select using (auth.uid() is not null);

drop policy if exists xm_supplies_read on public.xm_supplies;
create policy xm_supplies_read on public.xm_supplies for select
  using (public.xm_oversees_outlet(outlet_id));

drop policy if exists xm_counts_read on public.xm_counts;
create policy xm_counts_read on public.xm_counts for select
  using (user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id));
drop policy if exists xm_count_lines_read on public.xm_count_lines;
create policy xm_count_lines_read on public.xm_count_lines for select
  using (exists (select 1 from public.xm_counts c where c.id = count_id
                 and (c.user_id = auth.uid() or public.is_admin() or public.supervises_user(c.user_id))));

drop policy if exists xm_sales_read on public.xm_sales;
create policy xm_sales_read on public.xm_sales for select
  using (user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id));
drop policy if exists xm_sale_lines_read on public.xm_sale_lines;
create policy xm_sale_lines_read on public.xm_sale_lines for select
  using (exists (select 1 from public.xm_sales s where s.id = sale_id
                 and (s.user_id = auth.uid() or public.is_admin() or public.supervises_user(s.user_id))));

drop policy if exists xm_targets_read on public.xm_targets;
create policy xm_targets_read on public.xm_targets for select
  using (public.is_admin() or user_id = auth.uid() or public.supervises_user(user_id)
         or (outlet_id is not null and public.xm_oversees_outlet(outlet_id)));

drop policy if exists xm_reconciliations_read on public.xm_reconciliations;
create policy xm_reconciliations_read on public.xm_reconciliations for select
  using (exists (select 1 from public.xm_counts c where c.id = count_id
                 and (public.is_admin() or public.supervises_user(c.user_id))));

drop policy if exists xm_expiry_alerts_read on public.xm_expiry_alerts;
create policy xm_expiry_alerts_read on public.xm_expiry_alerts for select
  using (public.xm_oversees_outlet(outlet_id));

drop policy if exists xm_grades_read on public.xm_monthly_grades;
create policy xm_grades_read on public.xm_monthly_grades for select
  using (public.is_admin() or public.supervises_user(user_id));

revoke insert, update, delete, truncate on
  public.xm_settings_history, public.xm_stores, public.xm_supplies, public.xm_counts,
  public.xm_count_lines, public.xm_sales, public.xm_sale_lines, public.xm_targets,
  public.xm_reconciliations, public.xm_expiry_alerts, public.xm_monthly_grades
  from anon, authenticated;
revoke insert, delete, truncate on public.xm_settings from anon, authenticated;

-- =====================================================================
-- WRITING
-- =====================================================================
create or replace function public.xm_require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can do that in X Metrics';
  end if;
end;
$$;

-- A store joins X Metrics (or leaves, keeping its history).
create or replace function public.xm_set_store(p_outlet uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.xm_require_admin();
  if not exists (select 1 from public.outlets where id = p_outlet) then
    raise exception 'That store does not exist';
  end if;
  insert into public.xm_stores (outlet_id, enrolled_by, is_active)
  values (p_outlet, auth.uid(), p_active)
  on conflict (outlet_id) do update set is_active = excluded.is_active;
end;
$$;

-- A delivery to a store.
create or replace function public.xm_log_supply(
  p_outlet uuid, p_product uuid, p_quantity integer, p_batch text,
  p_expiry date, p_supplied_on date, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  perform public.xm_require_admin();
  if not exists (select 1 from public.xm_stores where outlet_id = p_outlet and is_active) then
    raise exception 'Add the store to X Metrics first';
  end if;
  if not exists (select 1 from public.products where id = p_product and is_active) then
    raise exception 'That product does not exist or is retired';
  end if;
  if p_supplied_on is null or p_supplied_on > public.business_date() then
    raise exception 'The supply date cannot be in the future';
  end if;
  if p_expiry is not null and p_expiry < p_supplied_on then
    raise exception 'The expiry date is before the supply date';
  end if;
  insert into public.xm_supplies
    (outlet_id, product_id, quantity, batch, expiry_date, supplied_on, note, logged_by)
  values (p_outlet, p_product, p_quantity, btrim(coalesce(p_batch, '')), p_expiry, p_supplied_on,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- A target for a person or a store, for a month.
create or replace function public.xm_set_target(p_month date, p_user uuid, p_outlet uuid, p_units integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  perform public.xm_require_admin();
  if p_user is not null and not exists (
    select 1 from public.profiles where id = p_user and public.is_field_role(role)) then
    raise exception 'Targets are set for merchandisers and marketers';
  end if;
  insert into public.xm_targets (month, user_id, outlet_id, target_units, set_by)
  values (date_trunc('month', p_month)::date, p_user, p_outlet, p_units, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- A mistake is voided, never deleted: who, when and why stay with it.
create or replace function public.xm_void(p_kind text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.xm_require_admin();
  if length(reason) < 3 then
    raise exception 'Say why it is being voided';
  end if;
  if p_kind = 'supply' then
    update public.xm_supplies set voided_at = now(), voided_by = auth.uid(), void_reason = reason
    where id = p_id and voided_at is null;
  elsif p_kind = 'count' then
    update public.xm_counts set voided_at = now(), voided_by = auth.uid(), void_reason = reason
    where id = p_id and voided_at is null;
  elsif p_kind = 'sales' then
    update public.xm_sales set voided_at = now(), voided_by = auth.uid(), void_reason = reason
    where id = p_id and voided_at is null;
  else
    raise exception 'Unknown record';
  end if;
  if not found then
    raise exception 'That record does not exist or is already voided';
  end if;
end;
$$;

-- Common checks for what staff send from a store.
create or replace function public.xm_check_field_submission(p_outlet uuid, p_captured_at timestamptz)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_count_stock() then
    raise exception 'You cannot submit stock or sales';
  end if;
  if not exists (select 1 from public.xm_stores where outlet_id = p_outlet and is_active) then
    raise exception 'That store is not in X Metrics yet. Ask your supervisor';
  end if;
  if p_outlet not in (select outlet_id from public.outlets_for_user(auth.uid())) then
    raise exception 'That store is not one of yours';
  end if;
  -- Kept on the phone while offline, but not for days.
  if p_captured_at is null or p_captured_at > now() + interval '2 minutes'
     or p_captured_at < now() - interval '72 hours' then
    raise exception 'Invalid capture time: it must be within the last 3 days';
  end if;
end;
$$;

-- A stock count, from the store, with a checked shelf photo.
create or replace function public.xm_submit_count(
  p_outlet uuid, p_lines jsonb, p_lat double precision, p_lng double precision,
  p_accuracy_m double precision, p_photo_path text, p_captured_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  store record;
  dist double precision;
  new_id uuid;
begin
  perform public.xm_check_field_submission(p_outlet, p_captured_at);

  if p_lat is null or p_lng is null or p_accuracy_m is null or p_accuracy_m > 100 then
    raise exception 'Your location is not accurate enough. Step near a window and try again';
  end if;
  select lat, lng, geofence_radius_m into store from public.outlets where id = p_outlet;
  -- A store waiting for its location cannot say where it is (034): the
  -- count is kept, with no distance.
  if store.lat is not null then
    dist := public.distance_metres(p_lat, p_lng, store.lat, store.lng);
    if dist > store.geofence_radius_m + 25 then
      raise exception 'You must be in the store to count it (you are % m away)', round(dist::numeric);
    end if;
  end if;

  if p_photo_path is null or p_photo_path not like auth.uid()::text || '/%'
     or coalesce(public.photo_verdict(p_photo_path), 'none') not in ('pass', 'unchecked') then
    raise exception 'Take the shelf photo in the app before sending the count';
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
    (outlet_id, user_id, count_date, captured_at, lat, lng, accuracy_m, distance_m, photo_path, is_opening)
  values
    (p_outlet, auth.uid(), (p_captured_at at time zone 'Africa/Lagos')::date, p_captured_at,
     p_lat, p_lng, p_accuracy_m, dist, p_photo_path,
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

-- A day's sales. Sending the same day again supersedes the earlier one.
create or replace function public.xm_submit_sales(
  p_outlet uuid, p_sale_date date, p_lines jsonb, p_photo_path text, p_captured_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  settings public.xm_settings;
  new_id uuid;
begin
  perform public.xm_check_field_submission(p_outlet, p_captured_at);
  select * into settings from public.xm_settings;

  if p_sale_date is null or p_sale_date > public.business_date()
     or p_sale_date < public.business_date() - 3 then
    raise exception 'Sales can be sent for today or the last 3 days';
  end if;
  if p_photo_path is not null and (p_photo_path not like auth.uid()::text || '/%'
     or coalesce(public.photo_verdict(p_photo_path), 'none') not in ('pass', 'unchecked')) then
    raise exception 'Take the photo in the app before sending';
  end if;
  if settings.sales_photo_required and p_photo_path is null then
    raise exception 'Take a photo of the shelf before sending the day''s sales';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Enter at least one product';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'Too many products in one report';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where not exists (select 1 from public.products p
                      where p.id::text = l->>'product_id' and p.is_active)
       or jsonb_typeof(l->'units') <> 'number'
       or (l->>'units')::numeric <> trunc((l->>'units')::numeric)
       or (l->>'units')::numeric not between 0 and 1000000
  ) then
    raise exception 'Every line needs a product and a whole number of units from 0 up';
  end if;
  if (select count(distinct l->>'product_id') from jsonb_array_elements(p_lines) l)
     <> jsonb_array_length(p_lines) then
    raise exception 'A product appears twice in the report';
  end if;

  insert into public.xm_sales (outlet_id, user_id, sale_date, captured_at, photo_path)
  values (p_outlet, auth.uid(), p_sale_date, p_captured_at, p_photo_path)
  returning id into new_id;

  insert into public.xm_sale_lines (sale_id, product_id, units)
  select new_id, (l->>'product_id')::uuid, (l->>'units')::integer
  from jsonb_array_elements(p_lines) l;

  update public.xm_sales set superseded_by = new_id
  where outlet_id = p_outlet and user_id = auth.uid() and sale_date = p_sale_date
    and id <> new_id and superseded_by is null and voided_at is null;

  return new_id;
end;
$$;

-- =====================================================================
-- RECONCILIATION
-- A count is the stock at the end of its day. Expected for a product:
-- the previous count + supplied after that day up to this one - sold
-- after that day up to this one. Run for counts from before today, when
-- the day's sales are in.
-- =====================================================================
create or replace function public.xm_reconcile_pending()
returns integer language plpgsql security definer set search_path = public as $$
declare
  settings public.xm_settings;
  c record;
  p record;
  prev record;
  supplied integer;
  sold integer;
  expected integer;
  pct numeric;
  flag uuid;
  done integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can run reconciliation';
  end if;
  select * into settings from public.xm_settings;

  for c in
    select * from public.xm_counts
    where reconciled_at is null and voided_at is null and count_date < public.business_date()
    order by count_date, created_at
    for update skip locked
  loop
    for p in
      select l.product_id, sum(l.on_shelf + l.in_backroom)::integer as actual
      from public.xm_count_lines l where l.count_id = c.id group by l.product_id
    loop
      select pc.id, pc.count_date, sum(pl.on_shelf + pl.in_backroom)::integer as units
        into prev
      from public.xm_counts pc
      join public.xm_count_lines pl on pl.count_id = pc.id and pl.product_id = p.product_id
      where pc.outlet_id = c.outlet_id and pc.voided_at is null and pc.id <> c.id
        and (pc.count_date < c.count_date or (pc.count_date = c.count_date and pc.created_at < c.created_at))
      group by pc.id, pc.count_date, pc.created_at
      order by pc.count_date desc, pc.created_at desc
      limit 1;

      -- No earlier count of this product: this one is its baseline.
      continue when prev.id is null;

      select coalesce(sum(s.quantity), 0)::integer into supplied
      from public.xm_supplies s
      where s.outlet_id = c.outlet_id and s.product_id = p.product_id and s.voided_at is null
        and s.supplied_on > prev.count_date and s.supplied_on <= c.count_date;

      select coalesce(sum(v.units), 0)::integer into sold
      from public.xm_live_sale_lines v
      where v.outlet_id = c.outlet_id and v.product_id = p.product_id
        and v.sale_date > prev.count_date and v.sale_date <= c.count_date;

      expected := prev.units + supplied - sold;
      pct := round(100.0 * abs(p.actual - expected) / greatest(abs(expected), p.actual, 1), 2);
      flag := null;

      if pct > settings.tolerance_pct then
        insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id, flag_date)
        values (c.user_id, 'stock_discrepancy',
                case when pct > 4 * settings.tolerance_pct then 'high' else 'medium' end,
                format('%s units of %s %s at %s: expected %s, counted %s',
                       abs(p.actual - expected),
                       (select name from public.products where id = p.product_id),
                       case when p.actual > expected then 'more than expected' else 'missing' end,
                       (select name from public.outlets where id = c.outlet_id),
                       expected, p.actual),
                jsonb_build_object('count_id', c.id, 'product_id', p.product_id,
                                   'previous_count_id', prev.id, 'previous_units', prev.units,
                                   'supplied', supplied, 'sold', sold,
                                   'expected', expected, 'actual', p.actual, 'variance_pct', pct),
                c.outlet_id, c.count_date)
        returning id into flag;
      end if;

      insert into public.xm_reconciliations
        (count_id, product_id, previous_count_id, previous_units, supplied_units, sold_units,
         expected_units, actual_units, variance_units, variance_pct, tolerance_pct, flagged, flag_id)
      values
        (c.id, p.product_id, prev.id, prev.units, supplied, sold, expected, p.actual,
         p.actual - expected, pct, settings.tolerance_pct, flag is not null, flag)
      on conflict (count_id, product_id) do nothing;
    end loop;

    update public.xm_counts set reconciled_at = now() where id = c.id;
    done := done + 1;
  end loop;
  return done;
end;
$$;

-- =====================================================================
-- EXPIRY
-- What is on hand: each batch in the latest count of each product at each
-- store. Each batch is alerted once per window it enters (the tightest
-- one it is in), and once more when it has expired (window 0).
-- =====================================================================
create or replace view public.xm_stock_on_hand
with (security_invoker = true) as
  with latest as (
    select distinct on (c.outlet_id, l.product_id) c.outlet_id, l.product_id, c.id as count_id, c.count_date
    from public.xm_counts c
    join public.xm_count_lines l on l.count_id = c.id
    where c.voided_at is null
    order by c.outlet_id, l.product_id, c.count_date desc, c.created_at desc
  )
  select x.outlet_id, x.product_id, x.count_id, x.count_date, l.batch, l.expiry_date,
         l.on_shelf, l.in_backroom, (l.on_shelf + l.in_backroom) as units
  from latest x
  join public.xm_count_lines l on l.count_id = x.count_id and l.product_id = x.product_id;

-- The batches last counted at the caller's stores, without the figures:
-- what the next count starts from, whoever counted last.
create or replace function public.xm_my_store_batches()
returns table (outlet_id uuid, product_id uuid, batch text, expiry_date date)
language sql stable security definer set search_path = public as $$
  select h.outlet_id, h.product_id, h.batch, h.expiry_date
  from public.xm_stock_on_hand h
  where h.units > 0
    and h.outlet_id in (select o.outlet_id from public.outlets_for_user(auth.uid()) o);
$$;
revoke all on function public.xm_my_store_batches() from public, anon;
grant execute on function public.xm_my_store_batches() to authenticated, service_role;

create or replace function public.xm_daily_velocity(p_outlet uuid, p_product uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(v.units), 0)::numeric / (select velocity_days from public.xm_settings)
  from public.xm_live_sale_lines v
  where v.outlet_id = p_outlet and v.product_id = p_product
    and v.sale_date > public.business_date() - (select velocity_days from public.xm_settings)
    and v.sale_date <= public.business_date();
$$;

create or replace function public.xm_expiry_scan()
returns integer language plpgsql security definer set search_path = public as $$
declare
  settings public.xm_settings;
  b record;
  left_days integer;
  win integer;
  vel numeric;
  to_sell numeric;
  added integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can run the expiry check';
  end if;
  select * into settings from public.xm_settings;

  for b in select * from public.xm_stock_on_hand where expiry_date is not null and units > 0 loop
    left_days := b.expiry_date - public.business_date();
    if left_days < 0 then
      win := 0;
    else
      select min(w) into win from unnest(settings.alert_windows_days) w where left_days <= w;
    end if;
    continue when win is null;

    vel := public.xm_daily_velocity(b.outlet_id, b.product_id);
    to_sell := case when vel > 0 then round(b.units / vel, 1) end;

    insert into public.xm_expiry_alerts
      (outlet_id, product_id, batch, expiry_date, window_days, days_left, units_on_hand,
       daily_velocity, days_to_sell, consider_pulling, count_id)
    values
      (b.outlet_id, b.product_id, b.batch, b.expiry_date, win, left_days, b.units,
       round(vel, 3), to_sell, (to_sell is null or to_sell > greatest(left_days, 0)), b.count_id)
    on conflict (outlet_id, product_id, batch, expiry_date, window_days) do nothing;
    if found then added := added + 1; end if;
  end loop;
  return added;
end;
$$;

-- Admins acknowledge an alert, with a note of what they decided.
create or replace function public.xm_acknowledge_expiry(p_alert uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.xm_require_admin();
  update public.xm_expiry_alerts
  set acknowledged_at = now(), acknowledged_by = auth.uid(), note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_alert and acknowledged_at is null;
  if not found then raise exception 'That alert does not exist or is already handled'; end if;
end;
$$;

-- New expiry alerts, handed to the server once to push to admins.
create or replace function public.xm_claim_expiry_alerts()
returns table (id uuid, outlet_name text, product_name text, batch text, expiry_date date,
               days_left integer, units_on_hand integer, consider_pulling boolean)
language sql security definer set search_path = public as $$
  with told as (
    update public.xm_expiry_alerts a set notified_at = now()
    where a.notified_at is null and a.acknowledged_at is null
    returning a.*
  )
  select t.id, o.name, p.name, t.batch, t.expiry_date, t.days_left, t.units_on_hand, t.consider_pulling
  from told t join public.outlets o on o.id = t.outlet_id join public.products p on p.id = t.product_id
  order by t.days_left;
$$;

-- =====================================================================
-- GRADING
-- One person, one month. Each factor is 0 to 100, or null when there is
-- nothing to judge it on; the weights of the factors that are there are
-- scaled up to 100.
--   sales:       units sold against their target (or their stores')
--   accuracy:    share of their reconciliations within tolerance
--   consistency: days they clocked in with that day's sales on time, and
--                with a count in the last count_interval_days
--   expiry:      expiry dates recorded, and nothing expired on the shelf
-- =====================================================================
create or replace function public.xm_grade(p_user uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  settings public.xm_settings;
  m_start date := date_trunc('month', p_month)::date;
  m_end date := (date_trunc('month', p_month) + interval '1 month')::date - 1;
  last_day date;
  sold integer; target integer; target_kind text;
  store_sold integer;
  recs integer; recs_ok integer;
  present integer; sales_ok integer; counts_ok integer;
  lines integer; dated integer; expired_on_shelf integer;
  c_sales numeric; c_acc numeric; c_cons numeric; c_exp numeric;
  weight_sum numeric; score numeric; band text;
begin
  if auth.uid() is not null and not (public.is_admin() or public.supervises_user(p_user)) then
    raise exception 'You can only see grades for your own team';
  end if;
  select * into settings from public.xm_settings;
  last_day := least(m_end, public.business_date() - 1);

  -- Sales against target.
  select coalesce(sum(units), 0)::integer into sold from public.xm_live_sale_lines
  where user_id = p_user and sale_date between m_start and m_end;
  select target_units into target from public.xm_current_targets
  where month = m_start and user_id = p_user;
  if target is not null then
    target_kind := 'person';
    c_sales := least(100, round(100.0 * sold / target, 1));
  else
    select sum(t.target_units)::integer into target from public.xm_current_targets t
    where t.month = m_start and t.outlet_id in (select outlet_id from public.outlets_for_user(p_user));
    if target is not null then
      target_kind := 'store';
      select coalesce(sum(units), 0)::integer into store_sold from public.xm_live_sale_lines
      where sale_date between m_start and m_end
        and outlet_id in (select t.outlet_id from public.xm_current_targets t
                          where t.month = m_start
                            and t.outlet_id in (select outlet_id from public.outlets_for_user(p_user)));
      c_sales := least(100, round(100.0 * store_sold / target, 1));
    end if;
  end if;

  -- Stock accuracy.
  select count(*), count(*) filter (where not r.flagged) into recs, recs_ok
  from public.xm_reconciliations r join public.xm_counts c on c.id = r.count_id
  where c.user_id = p_user and c.voided_at is null and c.count_date between m_start and m_end;
  if recs > 0 then c_acc := round(100.0 * recs_ok / recs, 1); end if;

  -- Reporting consistency, against the days they clocked in.
  with days as (
    select distinct a.attendance_date as d from public.attendance a
    where a.user_id = p_user and a.type = 'opening'
      and a.attendance_date between m_start and last_day
  )
  select count(*),
         count(*) filter (where exists (
           select 1 from public.xm_sales s
           where s.user_id = p_user and s.sale_date = days.d and s.voided_at is null
             and s.created_at <= ((days.d + 1)::timestamp at time zone 'Africa/Lagos')
                                 + make_interval(hours => settings.sales_grace_hours))),
         count(*) filter (where exists (
           select 1 from public.xm_counts c
           where c.user_id = p_user and c.voided_at is null
             and c.count_date between days.d - (settings.count_interval_days - 1) and days.d))
    into present, sales_ok, counts_ok
  from days;
  if present > 0 then c_cons := round(100.0 * (sales_ok + counts_ok) / (2 * present), 1); end if;

  -- Expiry handling.
  select count(*), count(l.expiry_date),
         count(*) filter (where l.expiry_date is not null and l.expiry_date < c.count_date and l.on_shelf > 0)
    into lines, dated, expired_on_shelf
  from public.xm_count_lines l join public.xm_counts c on c.id = l.count_id
  where c.user_id = p_user and c.voided_at is null and c.count_date between m_start and m_end;
  if lines > 0 then
    c_exp := round(50.0 * dated / lines + 50.0 * (1 - expired_on_shelf::numeric / lines), 1);
  end if;

  weight_sum := (case when c_sales is not null then settings.weight_sales else 0 end)
              + (case when c_acc is not null then settings.weight_accuracy else 0 end)
              + (case when c_cons is not null then settings.weight_consistency else 0 end)
              + (case when c_exp is not null then settings.weight_expiry else 0 end);
  if weight_sum > 0 then
    score := round((coalesce(c_sales * settings.weight_sales, 0)
                  + coalesce(c_acc * settings.weight_accuracy, 0)
                  + coalesce(c_cons * settings.weight_consistency, 0)
                  + coalesce(c_exp * settings.weight_expiry, 0)) / weight_sum, 1);
    band := case when score < settings.band_poor_below then 'Poor'
                 when score < settings.band_strong_from then 'Average'
                 else 'Strong' end;
  end if;

  return jsonb_build_object(
    'month', m_start, 'user_id', p_user, 'score', score, 'band', band,
    'weights', jsonb_build_object('sales', settings.weight_sales, 'accuracy', settings.weight_accuracy,
                                  'consistency', settings.weight_consistency, 'expiry', settings.weight_expiry),
    'bands', jsonb_build_object('poor_below', settings.band_poor_below, 'strong_from', settings.band_strong_from),
    'sales', jsonb_build_object('score', c_sales, 'units_sold', sold, 'target', target,
                                'target_kind', target_kind, 'store_units_sold', store_sold),
    'accuracy', jsonb_build_object('score', c_acc, 'reconciliations', recs, 'within_tolerance', recs_ok,
                                   'tolerance_pct', settings.tolerance_pct),
    'consistency', jsonb_build_object('score', c_cons, 'days_present', present,
                                      'sales_on_time', sales_ok, 'counts_in_time', counts_ok),
    'expiry', jsonb_build_object('score', c_exp, 'lines_counted', lines, 'expiry_recorded', dated,
                                 'expired_on_shelf', expired_on_shelf));
end;
$$;
revoke all on function public.xm_grade(uuid, date) from public, anon;
grant execute on function public.xm_grade(uuid, date) to authenticated, service_role;

-- Everyone graded for a month, live: field staff who clocked in or sent
-- anything that month, and whom the caller may see.
create or replace function public.xm_month_grades(p_month date)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.xm_grade(p.id, p_month) || jsonb_build_object('full_name', p.full_name)
  from public.profiles p
  where public.is_field_role(p.role)
    and (public.is_admin() or public.supervises_user(p.id))
    and (exists (select 1 from public.attendance a where a.user_id = p.id
                 and a.attendance_date between date_trunc('month', p_month)::date
                                           and (date_trunc('month', p_month) + interval '1 month')::date - 1)
         or exists (select 1 from public.xm_counts c where c.user_id = p.id
                    and c.count_date between date_trunc('month', p_month)::date
                                         and (date_trunc('month', p_month) + interval '1 month')::date - 1)
         or exists (select 1 from public.xm_sales s where s.user_id = p.id
                    and s.sale_date between date_trunc('month', p_month)::date
                                        and (date_trunc('month', p_month) + interval '1 month')::date - 1))
  order by p.full_name;
$$;
revoke all on function public.xm_month_grades(date) from public, anon;
grant execute on function public.xm_month_grades(date) to authenticated, service_role;

-- Keeps a month's grades as they stand. A month already kept is not
-- changed; only months that have ended can be kept.
create or replace function public.xm_finalise_month(p_month date)
returns integer language plpgsql security definer set search_path = public as $$
declare kept integer;
begin
  perform public.xm_require_admin();
  if (date_trunc('month', p_month) + interval '1 month')::date > public.business_date() then
    raise exception 'A month can be finalised once it has ended';
  end if;
  insert into public.xm_monthly_grades (month, user_id, grade, score, band, finalised_by)
  select date_trunc('month', p_month)::date, (g->>'user_id')::uuid, g,
         (g->>'score')::numeric, g->>'band', auth.uid()
  from public.xm_month_grades(p_month) g
  on conflict (month, user_id) do nothing;
  get diagnostics kept = row_count;
  return kept;
end;
$$;

create or replace function public.xm_review_grade(p_grade uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.xm_require_admin();
  update public.xm_monthly_grades
  set review_note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_grade;
  if not found then raise exception 'That grade does not exist'; end if;
end;
$$;

-- Execute rights: staff submit; admins manage; the server (service role)
-- runs the reconciliation and expiry sweeps from cron.
revoke all on function public.xm_require_admin() from public, anon;
revoke all on function public.xm_check_field_submission(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.xm_settings_keep() from public, anon, authenticated;
revoke all on function public.xm_claim_expiry_alerts() from public, anon, authenticated;
grant execute on function public.xm_claim_expiry_alerts() to service_role;
do $$
declare f text;
begin
  foreach f in array array[
    'xm_set_store(uuid, boolean)',
    'xm_log_supply(uuid, uuid, integer, text, date, date, text)',
    'xm_set_target(date, uuid, uuid, integer)',
    'xm_void(text, uuid, text)',
    'xm_submit_count(uuid, jsonb, double precision, double precision, double precision, text, timestamptz)',
    'xm_submit_sales(uuid, date, jsonb, text, timestamptz)',
    'xm_reconcile_pending()',
    'xm_expiry_scan()',
    'xm_acknowledge_expiry(uuid, text)',
    'xm_finalise_month(date)',
    'xm_review_grade(uuid, text)',
    'xm_daily_velocity(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

grant select on public.xm_live_sale_lines, public.xm_current_targets, public.xm_stock_on_hand to authenticated;

select 'X Metrics (043) installed' as result;
