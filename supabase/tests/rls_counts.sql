-- =====================================================================
-- Row level security for store counts and count requests (019, 020),
-- exercised as the `authenticated` role rather than as a superuser.
-- Run after rules.sql, whose people and data it reuses.
-- =====================================================================
set client_min_messages = notice;

-- What Supabase grants the API roles by default.
grant usage on schema public, auth to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function assert(boolean, text) to authenticated;

select id as ada   from auth.users where email = 'ada@xpel.ng'   \gset
select id as bala  from auth.users where email = 'bala@xpel.ng'  \gset
select id as boss  from auth.users where email = 'boss@xpel.ng'  \gset
select id as grace from auth.users where email = 'grace@xpel.ng' \gset
select id as tunde from auth.users where email = 'tunde@xpel.ng' \gset

set role authenticated;

select set_config('request.jwt.claim.sub', :'ada', false);
select assert((select count(*) from public.count_requests) = 1,
  'rls: a merchandiser sees the request made to them, and no other');
select assert((select count(*) from public.count_request_targets) = 1,
  'rls: and only their own line of it');
select assert((select count(*) from public.store_counts) > 0,
  'rls: they see their own counts');

select set_config('request.jwt.claim.sub', :'bala', false);
select assert((select count(*) from public.count_requests) = 0,
  'rls: somebody not asked sees no requests');
select assert((select count(*) from public.store_counts) = 0,
  'rls: nor anybody else''s counts');

select set_config('request.jwt.claim.sub', :'tunde', false);
select assert((select count(*) from public.count_requests) = 1,
  'rls: a supervisor sees the request they made, not one made to another team');
select assert((select count(*) from public.store_counts where user_id = :'ada') = 0,
  'rls: a supervisor does not see counts from outside their team');
select assert((select count(*) from public.count_request_progress) = 1,
  'rls: the progress view follows the same rules');

select set_config('request.jwt.claim.sub', :'boss', false);
select assert((select count(*) from public.count_requests) = 2,
  'rls: an admin sees every request');
select assert((select count(*) from public.store_counts) = (select count(*) from public.store_count_detail),
  'rls: and every count');

do $$
begin
  insert into public.count_requests (requested_by, due_date) values (auth.uid(), current_date);
  perform assert(false, 'rls: requests cannot be written directly');
exception when insufficient_privilege then
  perform assert(true, 'rls: requests cannot be written directly');
end $$;

reset role;
select 'ALL RLS CHECKS PASSED';
