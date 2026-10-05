-- =====================================================================
-- XTEND migration 030 — notifications from the Android and iOS apps
--
-- The Xtend apps (mobile/) cannot use web push; they register the phone's
-- own push token instead: Firebase on Android ("native-fcm:<token>"),
-- Apple on iPhone ("native-apns:<token>"). Those count as notifications
-- being on for the clock-in rule (027), the same as a web subscription.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.has_live_push(uuid)') is null then
    raise exception 'Run the notifications update (027, step 9) first, then this file';
  end if;
end $$;

create or replace function public.has_live_push(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.push_subscriptions s
    where s.user_id = p_user and s.is_active
      and (s.endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
           or s.endpoint ~ '^native-(fcm|apns):[A-Za-z0-9_:-]{20,}$')
  );
$$;

revoke all on function public.has_live_push(uuid) from public, anon;
grant execute on function public.has_live_push(uuid) to authenticated, service_role;

select 'App notifications (030) installed' as result;
