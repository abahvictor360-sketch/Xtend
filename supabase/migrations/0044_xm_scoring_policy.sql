-- =====================================================================
-- 0044: X Metrics scoring policy
--
-- Admins write the policy and scoring guidelines staff are graded by.
-- Each publish is a new version; nothing is overwritten, so the wording a
-- month was graded under can always be read back. Staff see the latest
-- version on the phone, with the live weights and bands beside it, mark it
-- read, and can see their own score as it stands.
-- =====================================================================

create table if not exists public.xm_policy_versions (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) between 3 and 120),
  body          text not null check (length(btrim(body)) between 20 and 20000),
  change_note   text check (change_note is null or length(btrim(change_note)) <= 300),
  published_by  uuid references public.profiles(id) on delete set null,
  published_at  timestamptz not null default clock_timestamp()
);
create index if not exists xm_policy_versions_latest on public.xm_policy_versions (published_at desc);

-- Who has read which version.
create table if not exists public.xm_policy_reads (
  policy_id  uuid not null references public.xm_policy_versions(id) on delete restrict,
  user_id    uuid not null references public.profiles(id) on delete restrict,
  read_at    timestamptz not null default now(),
  primary key (policy_id, user_id)
);

alter table public.xm_policy_versions enable row level security;
alter table public.xm_policy_reads enable row level security;

drop policy if exists xm_policy_read on public.xm_policy_versions;
create policy xm_policy_read on public.xm_policy_versions for select using (auth.uid() is not null);
drop policy if exists xm_policy_reads_read on public.xm_policy_reads;
create policy xm_policy_reads_read on public.xm_policy_reads for select
  using (user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id));

revoke insert, update, delete, truncate on public.xm_policy_versions, public.xm_policy_reads
  from anon, authenticated;

-- A starting policy, so staff are never shown an empty page. Admins
-- replace it by publishing their own.
insert into public.xm_policy_versions (title, body, change_note)
select 'How X Metrics scores your work',
'X Metrics gives every merchandiser and marketer a monthly score from 0 to 100, from what you send from your stores. The weights and bands below are set by the office.

What counts
- Sales against target: the units you sell in the month against your target (or your store''s target if you have none of your own).
- Stock accuracy: when your count matches what was expected (last count + supplied - sold), within the tolerance.
- Reporting consistency: on every day you clock in, send that day''s sales before the day ends, and keep your stock counts up to date.
- Expiry handling: record the expiry date of every batch you count, and never leave expired stock on the shelf.

Good practice
- Count shelf and backroom separately, batch by batch, and read the expiry date off the pack.
- Send your sales every day you work, even if you sold nothing.
- Take every count and sales report in the store, with the photo the app asks for.
- No signal? Save it anyway. The app sends it later, and it still counts as on time.

A gap between your count and the expected stock is a reason for the office to ask, not proof of wrongdoing. You will be asked to explain before anything is decided.',
'First version'
where not exists (select 1 from public.xm_policy_versions);

create or replace view public.xm_current_policy
with (security_invoker = true) as
  select * from public.xm_policy_versions order by published_at desc limit 1;
grant select on public.xm_current_policy to authenticated;

create or replace function public.xm_publish_policy(p_title text, p_body text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  perform public.xm_require_admin();
  insert into public.xm_policy_versions (title, body, change_note, published_by)
  values (btrim(p_title), btrim(p_body), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- Staff mark the current version read. Reading it again changes nothing.
create or replace function public.xm_mark_policy_read(p_policy uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.xm_policy_versions where id = p_policy) then
    raise exception 'That policy does not exist';
  end if;
  insert into public.xm_policy_reads (policy_id, user_id) values (p_policy, auth.uid())
  on conflict do nothing;
end;
$$;

revoke all on function public.xm_publish_policy(text, text, text) from public, anon;
grant execute on function public.xm_publish_policy(text, text, text) to authenticated, service_role;
revoke all on function public.xm_mark_policy_read(uuid) from public, anon;
grant execute on function public.xm_mark_policy_read(uuid) to authenticated, service_role;

-- Staff may see their own grade as it stands (same rules as 043; only who
-- may ask changes).
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
  if auth.uid() is not null and auth.uid() <> p_user
     and not (public.is_admin() or public.supervises_user(p_user)) then
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
             and s.captured_at <= ((days.d + 1)::timestamp at time zone 'Africa/Lagos')
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

select 'X Metrics scoring policy (044) installed' as result;
