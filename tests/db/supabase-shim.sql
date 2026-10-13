-- Minimal stand-in for the parts of a Supabase database that our migrations
-- depend on. Used ONLY by the PGlite test harness; never applied to a real
-- project. It deliberately reproduces Supabase's permissive defaults (ALL on
-- new public tables/functions for anon + authenticated) so the tests prove that
-- the migrations lock things down on their own.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text unique,
  is_anonymous boolean not null default false,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
