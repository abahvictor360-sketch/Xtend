-- =====================================================================
-- 0063: X Metrics feature switches
--
-- "Some of the features of X Metrics we are not going to use now but use
-- later." Admins switch X Metrics, or parts of it, off and back on. Off
-- hides the part and stops its work; nothing it recorded is deleted, and
-- switching it back on carries on from there.
--
--   * xm_settings gains five switches, all on, so nothing changes when
--     this file runs:
--       enabled           X Metrics as a whole (stock counts, stores,
--                         products). Off: every part below is off too.
--       expiry_enabled    expiry alerts and the expiry factor in grades.
--       supplies_enabled  logging and importing supplies.
--       grading_enabled   monthly grades, finalising and reviewing them.
--       sales_enabled     daily sales from staff, and sales targets.
--   * Reconciliation (last count + supplied - sold) needs both supplies
--     and sales: with either off, "expected" would be wrong and staff
--     would be flagged for gaps that are not there. While it is off,
--     counts still come in; when it is back on, a count is only compared
--     with an earlier count taken after it came back on (reconcile_from),
--     so the days nobody logged supplies or sales are never held against
--     anyone.
--   * Grades leave out the factors whose part is off (sales; accuracy
--     without reconciliation; expiry) and weigh the rest, as they already
--     do for a factor with nothing to judge.
--   * Expiry dates already known for a batch keep flowing from count to
--     count while expiry is off, so nothing is lost; no alerts are raised
--     or sent.
--   * Changes go through xm_set_features() (admins only); the existing
--     trigger keeps the earlier version in xm_settings_history and the
--     server audits it as xm.features.update.
-- =====================================================================

do $$
begin
  if to_regclass('public.xm_settings') is null or to_regclass('public.user_activity') is null then
    raise exception 'Run the X Metrics and activity log updates (043 to 062) first, then this file';
  end if;
end $$;

alter table public.xm_settings add column if not exists enabled boolean not null default true;
alter table public.xm_settings add column if not exists expiry_enabled boolean not null default true;
alter table public.xm_settings add column if not exists supplies_enabled boolean not null default true;
alter table public.xm_settings add column if not exists grading_enabled boolean not null default true;
alter table public.xm_settings add column if not exists sales_enabled boolean not null default true;
-- The first day reconciliation may compare counts from, after it was off.
alter table public.xm_settings add column if not exists reconcile_from date;

-- Whether a part of X Metrics is on now. 'xmetrics' is the whole module;
-- 'reconcile' needs supplies and sales. Anything unknown is off.
create or replace function public.xm_feature_on(p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.enabled and case p_feature
      when 'xmetrics'  then true
      when 'expiry'    then s.expiry_enabled
      when 'supplies'  then s.supplies_enabled
      when 'grading'   then s.grading_enabled
      when 'sales'     then s.sales_enabled
      when 'reconcile' then s.supplies_enabled and s.sales_enabled
      else false end
    from public.xm_settings s), false);
$$;
revoke all on function public.xm_feature_on(text) from public, anon;
grant execute on function public.xm_feature_on(text) to authenticated, service_role;

-- When reconciliation comes back on, it starts afresh from today.
create or replace function public.xm_settings_resume()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (old.enabled and old.supplies_enabled and old.sales_enabled)
     and (new.enabled and new.supplies_enabled and new.sales_enabled) then
    new.reconcile_from := public.business_date();
  end if;
  return new;
end;
$$;
revoke all on function public.xm_settings_resume() from public, anon, authenticated;
drop trigger if exists trg_xm_settings_resume on public.xm_settings;
create trigger trg_xm_settings_resume before update on public.xm_settings
  for each row execute function public.xm_settings_resume();

-- Admins switch parts on and off. Returns the switches as they now are.
create or replace function public.xm_set_features(
  p_enabled boolean, p_expiry boolean, p_supplies boolean, p_grading boolean, p_sales boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.xm_settings;
begin
  perform public.xm_require_admin();
  if p_enabled is null or p_expiry is null or p_supplies is null or p_grading is null or p_sales is null then
    raise exception 'Say whether each part is on or off';
  end if;
  update public.xm_settings
  set enabled = p_enabled, expiry_enabled = p_expiry, supplies_enabled = p_supplies,
      grading_enabled = p_grading, sales_enabled = p_sales
  where id
  returning * into s;
  return jsonb_build_object('enabled', s.enabled, 'expiry', s.expiry_enabled, 'supplies', s.supplies_enabled,
                            'grading', s.grading_enabled, 'sales', s.sales_enabled,
                            'reconcile_from', s.reconcile_from);
end;
$$;
revoke all on function public.xm_set_features(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.xm_set_features(boolean, boolean, boolean, boolean, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- What a switched-off part refuses. Staff get a plain line; the office
-- is told where to switch it back on.
-- ---------------------------------------------------------------------
create or replace function public.xm_feature_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'xm_counts' and not public.xm_feature_on('xmetrics') then
    raise exception 'Stock counts are not being collected here at the moment';
  elsif tg_table_name = 'xm_sales' and not public.xm_feature_on('sales') then
    raise exception 'Sales are not being collected at the moment';
  elsif tg_table_name in ('xm_supplies', 'xm_supply_imports') and not public.xm_feature_on('supplies') then
    raise exception 'Supplies are switched off in X Metrics. An admin can turn them on in X Metrics → Settings';
  elsif tg_table_name = 'xm_targets' and not public.xm_feature_on('sales') then
    raise exception 'Sales and targets are switched off in X Metrics. An admin can turn them on in X Metrics → Settings';
  elsif tg_table_name = 'xm_monthly_grades' and not public.xm_feature_on('grading') then
    raise exception 'Grading is switched off in X Metrics. An admin can turn it on in X Metrics → Settings';
  end if;
  return new;
end;
$$;
revoke all on function public.xm_feature_guard() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['xm_counts', 'xm_sales', 'xm_supplies', 'xm_supply_imports', 'xm_targets'] loop
    execute format('drop trigger if exists trg_%s_feature_guard on public.%I', t, t);
    execute format('create trigger trg_%s_feature_guard before insert on public.%I
                    for each row execute function public.xm_feature_guard()', t, t);
  end loop;
end $$;
-- Grades are kept (insert) and reviewed (update).
drop trigger if exists trg_xm_monthly_grades_feature_guard on public.xm_monthly_grades;
create trigger trg_xm_monthly_grades_feature_guard before insert or update on public.xm_monthly_grades
  for each row execute function public.xm_feature_guard();

-- ---------------------------------------------------------------------
-- Reconciliation (043), skipped while supplies or sales are off, and
-- after that only between counts taken since it came back on.
-- ---------------------------------------------------------------------
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
  -- Off: counts wait, untouched.
  if not public.xm_feature_on('reconcile') then
    return 0;
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

      -- No earlier count of this product: this one is its baseline. Nor
      -- one since reconciliation came back on: supplies or sales were not
      -- being logged in between, so this one is the new baseline.
      continue when prev.id is null
                 or (settings.reconcile_from is not null and prev.count_date < settings.reconcile_from);

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

-- ---------------------------------------------------------------------
-- Expiry (043): no new alerts, and none sent, while expiry is off.
-- ---------------------------------------------------------------------
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
  if not public.xm_feature_on('expiry') then
    return 0;
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

create or replace function public.xm_claim_expiry_alerts()
returns table (id uuid, outlet_name text, product_name text, batch text, expiry_date date,
               days_left integer, units_on_hand integer, consider_pulling boolean)
language sql security definer set search_path = public as $$
  with told as (
    update public.xm_expiry_alerts a set notified_at = now()
    where a.notified_at is null and a.acknowledged_at is null
      and public.xm_feature_on('expiry')
    returning a.*
  )
  select t.id, o.name, p.name, t.batch, t.expiry_date, t.days_left, t.units_on_hand, t.consider_pulling
  from told t join public.outlets o on o.id = t.outlet_id join public.products p on p.id = t.product_id
  order by t.days_left;
$$;
revoke all on function public.xm_claim_expiry_alerts() from public, anon, authenticated;
grant execute on function public.xm_claim_expiry_alerts() to service_role;

-- ---------------------------------------------------------------------
-- Grading (044's rules), leaving out the parts that are off. "parts"
-- says which factors were in play.
-- ---------------------------------------------------------------------
create or replace function public.xm_grade(p_user uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  settings public.xm_settings;
  m_start date := date_trunc('month', p_month)::date;
  m_end date := (date_trunc('month', p_month) + interval '1 month')::date - 1;
  last_day date;
  sales_on boolean := public.xm_feature_on('sales');
  recon_on boolean := public.xm_feature_on('reconcile');
  expiry_on boolean := public.xm_feature_on('expiry');
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
  if not public.xm_feature_on('grading') then
    raise exception 'Grading is switched off in X Metrics';
  end if;
  select * into settings from public.xm_settings;
  last_day := least(m_end, public.business_date() - 1);

  -- Sales against target.
  if sales_on then
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
  end if;

  -- Stock accuracy.
  if recon_on then
    select count(*), count(*) filter (where not r.flagged) into recs, recs_ok
    from public.xm_reconciliations r join public.xm_counts c on c.id = r.count_id
    where c.user_id = p_user and c.voided_at is null and c.count_date between m_start and m_end;
    if recs > 0 then c_acc := round(100.0 * recs_ok / recs, 1); end if;
  end if;

  -- Reporting consistency, against the days they clocked in. Without
  -- sales, only the counts.
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
  if present > 0 then
    c_cons := case when sales_on then round(100.0 * (sales_ok + counts_ok) / (2 * present), 1)
                   else round(100.0 * counts_ok / present, 1) end;
  end if;
  if not sales_on then sales_ok := null; end if;

  -- Expiry handling.
  if expiry_on then
    select count(*), count(l.expiry_date),
           count(*) filter (where l.expiry_date is not null and l.expiry_date < c.count_date and l.on_shelf > 0)
      into lines, dated, expired_on_shelf
    from public.xm_count_lines l join public.xm_counts c on c.id = l.count_id
    where c.user_id = p_user and c.voided_at is null and c.count_date between m_start and m_end;
    if lines > 0 then
      c_exp := round(50.0 * dated / lines + 50.0 * (1 - expired_on_shelf::numeric / lines), 1);
    end if;
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
    'parts', jsonb_build_object('sales', sales_on, 'accuracy', recon_on, 'expiry', expiry_on),
    'weights', jsonb_build_object('sales', settings.weight_sales, 'accuracy', settings.weight_accuracy,
                                  'consistency', settings.weight_consistency, 'expiry', settings.weight_expiry),
    'bands', jsonb_build_object('poor_below', settings.band_poor_below, 'strong_from', settings.band_strong_from),
    'sales', jsonb_build_object('score', c_sales, 'units_sold', coalesce(sold, 0), 'target', target,
                                'target_kind', target_kind, 'store_units_sold', store_sold),
    'accuracy', jsonb_build_object('score', c_acc, 'reconciliations', coalesce(recs, 0),
                                   'within_tolerance', coalesce(recs_ok, 0), 'tolerance_pct', settings.tolerance_pct),
    'consistency', jsonb_build_object('score', c_cons, 'days_present', present,
                                      'sales_on_time', sales_ok, 'counts_in_time', counts_ok),
    'expiry', jsonb_build_object('score', c_exp, 'lines_counted', coalesce(lines, 0),
                                 'expiry_recorded', coalesce(dated, 0), 'expired_on_shelf', coalesce(expired_on_shelf, 0)));
end;
$$;
revoke all on function public.xm_grade(uuid, date) from public, anon;
grant execute on function public.xm_grade(uuid, date) to authenticated, service_role;

-- Everyone graded for a month: nobody while grading is off.
create or replace function public.xm_month_grades(p_month date)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.xm_grade(p.id, p_month) || jsonb_build_object('full_name', p.full_name)
  from public.profiles p
  where public.xm_feature_on('grading')
    and public.is_field_role(p.role)
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

create or replace function public.xm_finalise_month(p_month date)
returns integer language plpgsql security definer set search_path = public as $$
declare kept integer;
begin
  perform public.xm_require_admin();
  if not public.xm_feature_on('grading') then
    raise exception 'Grading is switched off in X Metrics. An admin can turn it on in X Metrics → Settings';
  end if;
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
revoke all on function public.xm_finalise_month(date) from public, anon;
grant execute on function public.xm_finalise_month(date) to authenticated, service_role;

select 'X Metrics feature switches (063) installed' as result;
