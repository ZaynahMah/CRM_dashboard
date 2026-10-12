-- =====================================================================
-- CLiQ Push Ops — Backfill missing profile rows
-- Run THIRTEENTH. Safe to run more than once.
--
-- WHY THIS EXISTS
-- handle_new_auth_user() creates the profiles row, and it is an AFTER
-- INSERT trigger on auth.users. It therefore only ever runs for accounts
-- created after the trigger knew about their role.
--
-- Migration 08 added DESIGN to the role enum and to that trigger. Any
-- design@internal.local user created before 08 ran has an auth row but no
-- profiles row. The result: sign-in succeeds, getProfile() returns nothing,
-- the app shell sees no profile and redirects back to /login — which reads
-- as "Design login is not working" with no error anywhere.
--
-- This backfills a profiles row for every internal auth user that is
-- missing one. It does not create auth users; if design@internal.local does
-- not exist at all, create it in Supabase Dashboard > Authentication >
-- Users first (email design@internal.local, password `<set-in-supabase>`, and tick
-- "Auto Confirm User"), then run this.
-- =====================================================================

-- ---------- 1. What is actually wrong? Look before you fix. ----------
select
  u.email,
  upper(split_part(u.email, '@', 1)) as expected_role,
  u.created_at,
  (p.id is not null)                 as has_profile,
  p.role                             as current_role
from auth.users u
left join public.profiles p on p.id = u.id
where u.email like '%@internal.local'
order by u.email;

-- ---------- 2. Backfill ----------
insert into public.profiles (id, username, display_name, role)
select
  u.id,
  upper(split_part(u.email, '@', 1)),
  initcap(split_part(u.email, '@', 1)) || ' Team',
  upper(split_part(u.email, '@', 1))::app_role
from auth.users u
where u.email like '%@internal.local'
  and upper(split_part(u.email, '@', 1))
      in ('CATEGORY', 'CRM', 'CONTENT', 'EXECUTIVE', 'DESIGN')
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ---------- 3. Verify: this should return zero rows ----------
select u.email, 'MISSING PROFILE' as problem
from auth.users u
left join public.profiles p on p.id = u.id
where u.email like '%@internal.local'
  and p.id is null;
