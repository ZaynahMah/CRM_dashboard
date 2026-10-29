-- =====================================================================
-- CLiQ Push Ops — 30: shared custom PN dropdown options
--
-- Run THIRTIETH, after 29. Idempotent; safe to rerun. No data deletion.
--
-- WHY
-- src/config/pn_dropdown_options.json holds the agreed option lists. CRM
-- sometimes needs a brand code that is not in it yet, and typing it on one
-- row helps nobody else. This table stores added values so every CRM user
-- sees them, in every row and every session.
--
-- Deliberately GENERIC on `field`, so Segment 1 or Keywords can be opened
-- up later by a one-line config change rather than another migration.
-- Only 'brand_code' is enabled in the UI today.
--
-- The JSON stays the source of truth for the agreed lists: the helper
-- merges JSON first, then these rows, and de-duplicates.
-- =====================================================================

-- ═════════ READ-ONLY CHECK — run this FIRST ═════════
-- Confirms the table does not already exist and shows what would be created.
select
  to_regclass('public.custom_pn_options') is not null as table_already_exists,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'custom_pn_options') as existing_columns;
-- Expect: table_already_exists = false, existing_columns = 0 on a first run.
-- On a rerun: true / 5, and the migration below changes nothing.

-- ═════════ TABLE ═════════
create table if not exists custom_pn_options (
  id        uuid primary key default gen_random_uuid(),
  -- 'brand_code' today; 'segment_1' / 'keywords' possible later.
  field     text not null,
  value     text not null,
  added_by  uuid references profiles(id),
  added_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness per field: "Levis" and "levis" are the same
-- code, and the UI rejects the duplicate before it gets here.
create unique index if not exists custom_pn_options_field_value_uq
  on custom_pn_options (field, lower(value));

create index if not exists custom_pn_options_field_idx
  on custom_pn_options (field, added_at);

-- ═════════ RLS ═════════
-- Follows the pattern of the other reference tables: every signed-in role
-- may READ, because Category and Content see tracking values on their rows;
-- only CRM may INSERT, because the tracking fields are CRM-owned.
alter table custom_pn_options enable row level security;

drop policy if exists custom_pn_options_read on custom_pn_options;
create policy custom_pn_options_read on custom_pn_options
  for select to authenticated using (true);

drop policy if exists custom_pn_options_insert on custom_pn_options;
create policy custom_pn_options_insert on custom_pn_options
  for insert to authenticated
  with check (public.is_crm());

-- No update or delete policy: an added code is never silently changed or
-- removed, because a tracking code already generated from it would stop
-- matching. Removing one is a deliberate admin action.

-- ═════════ VERIFY ═════════
select c.relname, c.relrowsecurity as rls,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'custom_pn_options';
-- Expect: rls = true, policies = 2.

notify pgrst, 'reload schema';
