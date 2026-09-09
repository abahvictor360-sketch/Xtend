-- =====================================================================
-- Local test harness only. NOT part of the deployment.
--
-- Recreates just enough of the Supabase platform (auth schema, storage
-- schema, realtime publication) for a plain Postgres instance to accept
-- migrations 0001 and 0002, so their SQL can be checked before it ever
-- reaches the project. Run with:
--
--   psql -f supabase/tests/supabase_stub.sql
--   psql -f supabase/migrations/0001_init.sql
--   psql -f supabase/migrations/0002_logic.sql
--   psql -f supabase/tests/rules.sql
-- =====================================================================
create schema if not exists auth;
create schema if not exists storage;

create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- The tests set this to impersonate a signed-in user.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);

create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text not null
);

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

create publication supabase_realtime;
