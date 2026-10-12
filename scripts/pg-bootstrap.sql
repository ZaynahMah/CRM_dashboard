-- =====================================================================
-- Make a plain PostgreSQL behave like Supabase, so migrations and RPCs can
-- be tested the way they will actually run.
--
-- Emulates: the auth schema and auth.users, auth.uid() backed by a session
-- setting (so a test can switch users), the anon / authenticated /
-- service_role roles, the supabase_realtime publication, and pg_safeupdate
-- (DELETE/UPDATE without WHERE -> SQLSTATE 21000).
-- =====================================================================

create extension if not exists pgcrypto;

-- ───────── roles ─────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to authenticated, service_role;
alter default privileges in schema public
  grant all on functions to authenticated, service_role;

-- ───────── auth schema ─────────
create schema if not exists auth;
grant usage on schema auth to authenticated, service_role;

create table if not exists auth.users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique,
  encrypted_password text,
  banned_until    timestamptz,
  created_at      timestamptz not null default now(),
  last_sign_in_at timestamptz
);
grant select on auth.users to authenticated;

/**
 * The current user id, read from a session setting so a test can switch
 * identity with `set local request.jwt.claim.sub = '<uuid>'` — the same
 * mechanism PostgREST uses.
 */
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- ───────── realtime publication ─────────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ───────── pg_safeupdate emulation ─────────
/**
 * Supabase runs pg_safeupdate, which rejects an unqualified DELETE or
 * UPDATE with SQLSTATE 21000. The real extension is a C hook and is not
 * available here, so this reproduces the rule where it matters: the
 * harness parses each statement it sends and refuses it, and the check is
 * also exposed as a function so SQL under test can assert on it.
 *
 * This is the bug class that broke the live reset while every local test
 * passed, so emulating it is the whole point.
 */
create or replace function public.safeupdate_check(stmt text)
returns void language plpgsql as $$
declare s text := lower(regexp_replace(stmt, '--[^\n]*', ' ', 'g'));
begin
  s := regexp_replace(s, '\s+', ' ', 'g');
  if s ~ '(^|; *)(delete from|update) [a-z_."]+[^;]*' then
    -- Examine each delete/update statement in the string.
    declare part text;
    begin
      foreach part in array regexp_split_to_array(s, ';')
      loop
        if part ~ '^\s*(delete from|update) [a-z_."]+' and part !~ ' where ' then
          raise exception 'DELETE requires a WHERE clause' using errcode = '21000';
        end if;
      end loop;
    end;
  end if;
end $$;
