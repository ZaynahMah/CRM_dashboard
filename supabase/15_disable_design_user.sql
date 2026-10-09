-- =====================================================================
-- CLiQ Push Ops — 15: remove the DESIGN account
--
-- Run FIFTEENTH, after 14. Safe to run more than once.
--
-- The app no longer has a DESIGN role, so this account cannot reach any
-- screen even if it authenticates. Removing it closes the login entirely.
-- =====================================================================

-- ---------- 1. PREVIEW: confirm what you are about to remove ----------
select u.id, u.email, u.created_at, u.last_sign_in_at, p.role, p.display_name
from auth.users u
left join public.profiles p on p.id = u.id
where u.email = 'design@internal.local';

-- ---------- 2a. OPTION A (RECOMMENDED): disable, keep the record ----------
-- Blocks sign-in while preserving the row, so historic activity_logs and
-- calendar_updated_by references still resolve to a real user.
-- Reversible: set banned_until back to null.

update auth.users
   set banned_until = 'infinity'
 where email = 'design@internal.local';

-- Also drop the profile row so no code path can resolve a role for it.
-- activity_logs.actor_id is ON DELETE SET NULL, so history survives as
-- "actor unknown" rather than being deleted.
delete from public.profiles
 where id in (select id from auth.users where email = 'design@internal.local');

-- ---------- 2b. OPTION B: delete the account outright ----------
-- Only if you want the auth row gone. Run 2a's profile delete first.
-- Prefer the Supabase Dashboard (Authentication > Users > Delete user),
-- which handles the auth schema's internal tables properly. If you must do
-- it in SQL, uncomment:
--
-- delete from auth.users where email = 'design@internal.local';

-- ---------- 2c. DROP THE DESIGN RLS POLICY ----------
-- Migration 08 created campaigns_design_write, granting any DESIGN-role
-- session full UPDATE on campaigns. Banning the account closes the login,
-- but the policy is still live — defence in depth means removing the grant
-- too, not only the user who could use it.
drop policy if exists campaigns_design_write on campaigns;

-- ---------- 3. VERIFY ----------
-- No policy anywhere may reference DESIGN. Zero rows expected.
select schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') ilike '%DESIGN%'
    or coalesce(with_check, '') ilike '%DESIGN%'
    or policyname ilike '%design%');

-- banned_until should be 'infinity' (or the row gone), and role null.
select u.email, u.banned_until, p.role
from auth.users u
left join public.profiles p on p.id = u.id
where u.email = 'design@internal.local';

-- No profile should carry the DESIGN role any more. Zero rows expected.
select id, username, role from public.profiles where role::text = 'DESIGN';

-- NOTE: the app_role enum still contains 'DESIGN'. It is deliberately left
-- in place — dropping a value from a Postgres enum requires recreating the
-- type and rewriting every dependent column, and an unused enum value is
-- harmless.
