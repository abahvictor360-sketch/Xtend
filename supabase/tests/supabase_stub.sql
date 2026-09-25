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
--   psql -f supabase/migrations/0003_harden.sql
--   psql -f supabase/migrations/0004_tracking_coverage.sql
--   psql -f supabase/tests/rules.sql
-- =====================================================================
-- Supabase's API roles. Migration 003 grants and revokes against these.
do $$
begin
  create role anon nologin noinherit;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null;
end $$;

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
  name      text not null,
  created_at timestamptz not null default now()
);

-- Supabase rejects a direct DELETE on storage.objects and tells you to use
-- the Storage API. Without this guard the harness happily accepts SQL that
-- fails in production, which is exactly how the old retention job shipped
-- broken. Deletes made by the Storage API arrive as the storage owner, so
-- the stub lets a superuser through the same way.
create or replace function storage.protect_delete() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('storage.api', true), 'off') <> 'on' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.';
  end if;
  return old;
end;
$$;

create trigger protect_delete before delete on storage.objects
  for each row execute function storage.protect_delete();

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

create publication supabase_realtime;
