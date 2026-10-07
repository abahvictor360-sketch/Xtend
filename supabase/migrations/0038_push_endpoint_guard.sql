-- =====================================================================
-- XTEND migration 038 — push only to the push services
--
-- The server sends a POST to every address a device registers for
-- notifications. Any address used to be accepted, so a signed-in user
-- could register one inside the server's own network (127.0.0.1, the VPS
-- provider's metadata address, a database port) and have the server call
-- it whenever they were sent a notification. The app now accepts only the
-- real push services and the Xtend apps' own tokens (lib/push-endpoint.ts);
-- this makes the table refuse anything else too, and removes what is
-- already there.
-- =====================================================================

delete from public.push_subscriptions
where not (
  endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/'
  or (endpoint ~ '^native-(fcm|apns):[A-Za-z0-9_:-]{20,}$' and length(endpoint) <= 4200)
);

alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_check;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_check check (
  endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/'
  or (endpoint ~ '^native-(fcm|apns):[A-Za-z0-9_:-]{20,}$' and length(endpoint) <= 4200)
);

select 'Push endpoint guard (038) installed' as result;
