-- =====================================================================
-- XTEND migration 020 — store counts happen when they are asked for
--
-- A store count is not a daily chore. It happens in two cases:
--
--   1. A supervisor (or an admin) asks for one: they pick who counts and
--      by when. It stays open for those people until the due date, or
--      until whoever asked for it closes it.
--   2. At the end of the month: the last three days of every month are a
--      count window for everyone, so a month-end that falls on a Sunday
--      still has working days in it.
--
-- Outside those, submit_store_count() refuses, whatever the phone sends.
-- "Sold" now means sold since the last count, since counts are periods
-- apart rather than a day.
-- =====================================================================

-- 020 builds on 019. Say so plainly rather than fail halfway with
-- "relation store_counts does not exist".
do $$
begin
  if to_regclass('public.store_counts') is null then
    raise exception 'Run 0019_store_counts.sql first, then this file';
  end if;
end $$;

-- How many days at the end of each month counting is open for everyone.
create or replace function public.month_end_count_days()
returns integer language sql immutable as $$ select 3 $$;

create or replace function public.is_month_end_window(d date default public.business_date())
returns boolean language sql stable set search_path = public as $$
  select d > ((date_trunc('month', d) + interval '1 month')::date - public.month_end_count_days() - 1)
$$;

revoke all on function public.is_month_end_window(date) from public, anon;
grant execute on function public.is_month_end_window(date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- COUNT REQUESTS
-- ---------------------------------------------------------------------
create table if not exists public.count_requests (
  id           uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  due_date     date not null,
  note         text check (note is null or length(note) <= 500),
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);

create table if not exists public.count_request_targets (
  request_id uuid not null references public.count_requests(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete restrict,
  primary key (request_id, user_id)
);

create index if not exists count_request_targets_by_user on public.count_request_targets (user_id);

alter table public.count_requests enable row level security;
alter table public.count_request_targets enable row level security;

-- The policies ask through security definer helpers: each table looking at
-- the other directly would be policy recursion.
create or replace function public.owns_count_request(p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.count_requests r
                 where r.id = p_id and r.requested_by = auth.uid());
$$;

create or replace function public.can_see_count_request(p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.owns_count_request(p_id)
      or exists (select 1 from public.count_request_targets t
                 where t.request_id = p_id
                   and (t.user_id = auth.uid() or public.supervises_user(t.user_id)));
$$;

revoke all on function public.owns_count_request(uuid) from public, anon;
grant execute on function public.owns_count_request(uuid) to authenticated, service_role;
revoke all on function public.can_see_count_request(uuid) from public, anon;
grant execute on function public.can_see_count_request(uuid) to authenticated, service_role;

drop policy if exists count_requests_select on public.count_requests;
create policy count_requests_select on public.count_requests
  for select using (public.can_see_count_request(id));

-- Somebody asked to count sees their own line, not the rest of the list.
drop policy if exists count_request_targets_select on public.count_request_targets;
create policy count_request_targets_select on public.count_request_targets
  for select using (
    public.is_admin()
    or user_id = auth.uid()
    or public.supervises_user(user_id)
    or public.owns_count_request(request_id)
  );

-- Writes go through the functions below.
revoke insert, update, delete, truncate on public.count_requests from anon, authenticated;
revoke insert, update, delete, truncate on public.count_request_targets from anon, authenticated;

-- Which count a submission belongs to; null for a month-end count.
alter table public.store_counts
  add column if not exists request_id uuid references public.count_requests(id) on delete set null;

-- ---------------------------------------------------------------------
-- The open request for the signed-in person, if any: the one due soonest.
-- ---------------------------------------------------------------------
create or replace function public.my_open_count_request()
returns table (id uuid, due_date date, note text, requested_by_name text)
language sql stable security definer set search_path = public as $$
  select r.id, r.due_date, r.note, p.full_name
  from public.count_requests r
  join public.count_request_targets t on t.request_id = r.id
  join public.profiles p on p.id = r.requested_by
  where t.user_id = auth.uid()
    and r.closed_at is null
    and r.due_date >= public.business_date()
  order by r.due_date, r.created_at
  limit 1;
$$;

revoke all on function public.my_open_count_request() from public, anon;
grant execute on function public.my_open_count_request() to authenticated, service_role;

-- Whether the signed-in person may count right now, and why.
create or replace function public.store_count_status()
returns jsonb
language sql stable security definer set search_path = public as $$
  with req as (select * from public.my_open_count_request())
  select case
    when not public.can_count_stock() then
      jsonb_build_object('open', false, 'reason', 'not_allowed')
    when exists (select 1 from req) then
      (select jsonb_build_object('open', true, 'reason', 'request', 'request_id', req.id,
                                 'due_date', req.due_date, 'note', req.note,
                                 'requested_by', req.requested_by_name) from req)
    when public.is_month_end_window() then
      jsonb_build_object('open', true, 'reason', 'month_end',
        'due_date', ((date_trunc('month', public.business_date()) + interval '1 month')::date - 1))
    else
      jsonb_build_object('open', false, 'reason', 'none',
        'next_month_end', ((date_trunc('month', public.business_date()) + interval '1 month')::date
                           - public.month_end_count_days()))
  end;
$$;

revoke all on function public.store_count_status() from public, anon;
grant execute on function public.store_count_status() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Asking for a count. An admin may ask anybody who counts; a supervisor,
-- only their own team. Returns the request id.
-- ---------------------------------------------------------------------
create or replace function public.request_store_count(
  p_user_ids uuid[],
  p_due_date date,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  wanted uuid[] := coalesce(p_user_ids, '{}'::uuid[]);
  new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.is_active or me.role not in ('admin'::user_role, 'supervisor'::user_role) then
    raise exception 'Only a supervisor or an admin can ask for a store count';
  end if;
  if array_length(wanted, 1) is null then
    raise exception 'Pick at least one person to count';
  end if;
  if p_due_date is null or p_due_date < public.business_date() then
    raise exception 'The due date cannot be in the past';
  end if;
  if p_due_date > public.business_date() + 60 then
    raise exception 'The due date must be within 60 days';
  end if;

  if exists (
    select 1 from unnest(wanted) as w(id)
    left join public.profiles p on p.id = w.id
    where p.id is null
       or not p.is_active
       or p.role not in ('merchandiser'::user_role, 'marketer'::user_role)
       or not (me.role = 'admin' or public.supervises_user(p.id))
  ) then
    raise exception 'You can only ask your own active merchandisers and marketers to count';
  end if;

  insert into public.count_requests (requested_by, due_date, note)
  values (me.id, p_due_date, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into new_id;

  insert into public.count_request_targets (request_id, user_id)
  select distinct new_id, w.id from unnest(wanted) as w(id);

  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (me.id, 'store_count.request', 'count_requests', new_id,
          jsonb_build_object('user_ids', to_jsonb(wanted), 'due_date', p_due_date));

  return new_id;
end;
$$;

revoke all on function public.request_store_count(uuid[], date, text) from public, anon;
grant execute on function public.request_store_count(uuid[], date, text) to authenticated, service_role;

-- Closing a request early: whoever asked for it, or an admin.
create or replace function public.close_count_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.count_requests
  set closed_at = now()
  where id = p_request_id
    and closed_at is null
    and (requested_by = auth.uid() or public.is_admin());
  if not found then
    raise exception 'That request is already closed, or it is not yours to close';
  end if;
end;
$$;

revoke all on function public.close_count_request(uuid) from public, anon;
grant execute on function public.close_count_request(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- submit_store_count: the same rules as before, plus "is a count open?".
-- ---------------------------------------------------------------------
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

  insert into public.store_counts
    (user_id, outlet_id, product_id, count_date, in_store, sold, request_id)
  select auth.uid(), p_outlet_id, (l->>'product_id')::uuid, today,
         (l->>'in_store')::integer, (l->>'sold')::integer, req
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

-- ---------------------------------------------------------------------
-- READ MODEL: each request with how many of its people have counted.
-- ---------------------------------------------------------------------
create or replace view public.count_request_progress
with (security_invoker = true) as
  select
    r.id,
    r.requested_by,
    p.full_name as requested_by_name,
    r.due_date,
    r.note,
    r.created_at,
    r.closed_at,
    (r.closed_at is null and r.due_date >= public.business_date()) as is_open,
    (select count(*) from public.count_request_targets t where t.request_id = r.id) as people,
    (select count(distinct c.user_id) from public.store_counts c where c.request_id = r.id) as counted,
    coalesce((
      select array_agg(tp.full_name order by tp.full_name)
      from public.count_request_targets t
      join public.profiles tp on tp.id = t.user_id
      where t.request_id = r.id
        and not exists (select 1 from public.store_counts c
                        where c.request_id = r.id and c.user_id = t.user_id)
    ), '{}'::text[]) as waiting_on
  from public.count_requests r
  join public.profiles p on p.id = r.requested_by;

grant select on public.count_request_progress to authenticated;
