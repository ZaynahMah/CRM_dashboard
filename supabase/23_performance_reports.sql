-- =====================================================================
-- CLiQ Push Ops — 23: persistent Executive performance reports
--
-- Run TWENTY-THIRD, after 22. Idempotent; safe to rerun.
--
-- WHY
-- The Performance module parsed the workbook in the browser and held it in
-- React state. A refresh, a logout, a new deploy or a second Executive and
-- it was gone. This stores BOTH the original workbook (Supabase Storage)
-- and the parsed metrics (tables below), so the dashboard loads from
-- storage and never reparses.
--
-- A BUCKET MUST BE CREATED BY HAND FIRST — SQL cannot create one. Name and
-- settings are in the header of 23_STORAGE_SETUP.md. The policies at the
-- bottom of this file are guarded, so running this before the bucket exists
-- is harmless; rerun afterwards to attach them.
--
-- DELIBERATELY SEPARATE FROM CAMPAIGN RESET. Nothing here is touched by
-- reset_campaigns_with_archive: it deletes campaigns and their children
-- only, and these tables are not children of campaigns. A campaign reset
-- must never destroy a performance report.
-- =====================================================================

-- ═════════ 1. THE REPORT (one row per upload = version history) ═════════
create table if not exists performance_reports (
  id                uuid primary key default gen_random_uuid(),
  file_name         text not null,
  -- Path inside the storage bucket. Null only if the file upload failed but
  -- the metrics parsed, which the UI surfaces rather than hides.
  storage_path      text,
  uploaded_by       uuid references profiles(id),
  uploaded_at       timestamptz not null default now(),
  -- Exactly one row may be current. Enforced by the partial unique index
  -- below, not by convention.
  is_current        boolean not null default false,
  sheets_found      text[] not null default '{}',
  sheet_count       integer not null default 0,
  warnings          text[] not null default '{}',
  current_month     text,
  row_count         integer not null default 0
);

-- One and only one current report, enforced by the database.
create unique index if not exists performance_reports_one_current
  on performance_reports (is_current) where is_current;

create index if not exists performance_reports_uploaded_idx
  on performance_reports (uploaded_at desc);

-- ═════════ 2. PARSED METRICS ═════════
-- Three tables matching the three shapes the parser produces. Every row
-- belongs to a report and goes with it when that report is deleted.
--
-- cvr is stored as the decimal the sheet contains (0.0157), never as a
-- percentage — the same contract the parser and the UI already use.

create table if not exists performance_monthly_kpi (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references performance_reports(id) on delete cascade,
  month         text,
  platform      text,
  period_status text,
  visits        numeric,
  orders        numeric,
  revenue_inr   numeric,
  cvr           numeric,
  aov_inr       numeric,
  rpv_inr       numeric
);
create index if not exists performance_monthly_kpi_report_idx
  on performance_monthly_kpi (report_id);

create table if not exists performance_dimensions (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references performance_reports(id) on delete cascade,
  -- category | remarketing_flow | segment | pn_type | cohort | occasion | tag
  sheet_key       text not null,
  month           text,
  dimension_value text,
  visits          numeric,
  orders          numeric,
  revenue_inr     numeric,
  cvr             numeric,
  aov_inr         numeric,
  rpv_inr         numeric,
  -- Columns the sheet carried that map to no known metric. Preserved rather
  -- than dropped, matching the parser's existing behaviour.
  extra           jsonb
);
create index if not exists performance_dimensions_report_idx
  on performance_dimensions (report_id, sheet_key);

create table if not exists performance_top_pn (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references performance_reports(id) on delete cascade,
  pn_name     text,
  rank        integer,
  visits      numeric,
  orders      numeric,
  revenue_inr numeric,
  cvr         numeric,
  aov_inr     numeric,
  rpv_inr     numeric
);
create index if not exists performance_top_pn_report_idx
  on performance_top_pn (report_id);

-- ═════════ 3. RLS ═════════
-- Everyone may VIEW the dashboard; only EXECUTIVE may upload or restore.
-- CRM, CATEGORY and CONTENT get read-only access.

alter table performance_reports      enable row level security;
alter table performance_monthly_kpi  enable row level security;
alter table performance_dimensions   enable row level security;
alter table performance_top_pn       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['performance_reports','performance_monthly_kpi',
                           'performance_dimensions','performance_top_pn']
  loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format(
      'create policy %1$s_read on %1$s for select to authenticated using (true)', t);

    execute format('drop policy if exists %1$s_exec_write on %1$s', t);
    execute format($f$
      create policy %1$s_exec_write on %1$s for all to authenticated
      using (public.current_app_role() = 'EXECUTIVE'::app_role)
      with check (public.current_app_role() = 'EXECUTIVE'::app_role)$f$, t);
  end loop;
end $$;

-- ═════════ 4. PROMOTE A REPORT TO CURRENT ═════════
-- One place that flips is_current, so the partial unique index can never be
-- violated by two clients racing. SECURITY DEFINER with a role check, like
-- every other privileged action in this schema.
create or replace function public.set_current_performance_report(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_app_role() is distinct from 'EXECUTIVE'::app_role then
    raise exception 'Only EXECUTIVE can change the active performance report.';
  end if;
  if not exists (select 1 from performance_reports where id = p_report_id) then
    raise exception 'No such performance report.';
  end if;
  -- Clear first, then set: the unique index allows only one true at a time.
  update performance_reports set is_current = false where is_current;
  update performance_reports set is_current = true  where id = p_report_id;
end $$;
revoke all on function public.set_current_performance_report(uuid) from public;
grant execute on function public.set_current_performance_report(uuid) to authenticated;

-- ═════════ 5. STORAGE POLICIES ═════════
-- Guarded: storage.objects exists only on Supabase. Running this file on a
-- plain Postgres (the QC harness) skips this block instead of failing.
do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'storage' and table_name = 'objects') then
    raise notice 'storage.objects not present — skipping bucket policies.';
    return;
  end if;

  -- Everyone signed in may download the workbook; only EXECUTIVE may write.
  execute $p$drop policy if exists perf_reports_read on storage.objects$p$;
  execute $p$create policy perf_reports_read on storage.objects
    for select to authenticated
    using (bucket_id = 'performance-reports')$p$;

  execute $p$drop policy if exists perf_reports_write on storage.objects$p$;
  execute $p$create policy perf_reports_write on storage.objects
    for insert to authenticated
    with check (bucket_id = 'performance-reports'
      and public.current_app_role() = 'EXECUTIVE'::app_role)$p$;

  execute $p$drop policy if exists perf_reports_delete on storage.objects$p$;
  execute $p$create policy perf_reports_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'performance-reports'
      and public.current_app_role() = 'EXECUTIVE'::app_role)$p$;
end $$;

-- ═════════ VERIFY ═════════
-- All four tables present, RLS on, exactly one "one current" index.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
        where p.schemaname='public' and p.tablename=c.relname) as policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'performance_%'
order by c.relname;

-- Reset must NOT touch these. Zero rows expected: no performance table is a
-- child of campaigns, so a campaign reset cannot cascade into one.
select tc.table_name, kcu.column_name, 'unexpectedly references campaigns' as problem
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
where tc.table_schema='public' and tc.constraint_type='FOREIGN KEY'
  and tc.table_name like 'performance_%' and ccu.table_name='campaigns';

notify pgrst, 'reload schema';
