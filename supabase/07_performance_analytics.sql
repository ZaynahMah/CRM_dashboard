-- =====================================================================
-- CLiQ Push Ops — Performance Analytics module
-- Run SEVENTH. Adds a self-contained monthly CRM performance reporting
-- layer: one .xlsx upload per month rebuilds the entire Performance tab.
-- Independent of the campaigns/scheduling tables — reads/writes only
-- the tables below.
-- =====================================================================

-- ---------- monthly platform-level KPI history ----------
create table if not exists perf_monthly_kpi (
  month text not null,              -- stored verbatim from the workbook (e.g. "Aug 2026")
  platform text not null,
  period_status text not null default 'Complete' check (period_status in ('Complete','Partial')),
  visits bigint,
  orders bigint,
  revenue_inr numeric,
  cvr numeric,                      -- stored as decimal, e.g. 0.0157 — never a percentage string
  aov_inr numeric,
  rpv_inr numeric,
  updated_at timestamptz not null default now(),
  primary key (month, platform)
);

-- ---------- one generic table for every "Month | <Dimension> | metrics" sheet ----------
-- sheet_key distinguishes which of the seven identically-shaped sheets a row came from.
create table if not exists perf_dimension (
  id uuid primary key default gen_random_uuid(),
  sheet_key text not null check (sheet_key in
    ('category','remarketing_flow','segment','pn_type','cohort','occasion','tag')),
  month text not null,
  dimension_value text not null,    -- the Category / Segment / PN Type / Cohort / Occasion / Tag name
  visits bigint,
  orders bigint,
  revenue_inr numeric,
  cvr numeric,
  aov_inr numeric,
  rpv_inr numeric,
  updated_at timestamptz not null default now(),
  unique (sheet_key, month, dimension_value)
);
create index if not exists perf_dimension_lookup on perf_dimension(sheet_key, month);
create index if not exists perf_dimension_trend on perf_dimension(sheet_key, dimension_value);

-- ---------- Top 10 Performing PN — always reflects the current month, fully replaced each upload ----------
create table if not exists perf_top_pn (
  id uuid primary key default gen_random_uuid(),
  pn_name text not null,
  visits bigint,
  orders bigint,
  revenue_inr numeric,
  cvr numeric,
  aov_inr numeric,
  rpv_inr numeric,
  rank int not null,
  uploaded_at timestamptz not null default now()
);

-- ---------- upload audit trail ----------
create table if not exists perf_uploads (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  month text,
  uploaded_by uuid references profiles(id),
  sheets_found text[],
  warnings text[],
  uploaded_at timestamptz not null default now()
);

-- ---------- cached AI analysis (per-table cards + the total panel) ----------
-- filter_key lets the same cache entry serve repeat views of the same filter state;
-- the "Regenerate analysis" button in the UI bypasses this and overwrites it.
create table if not exists perf_ai_cache (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('table','total')),
  sheet_key text,                    -- null when scope = 'total'
  month text not null,
  filter_key text not null default 'default',
  analysis jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  unique (scope, sheet_key, month, filter_key)
);

-- ---------- RLS ----------
alter table perf_monthly_kpi enable row level security;
alter table perf_dimension   enable row level security;
alter table perf_top_pn      enable row level security;
alter table perf_uploads     enable row level security;
alter table perf_ai_cache    enable row level security;

-- Leadership-ready view: CRM (full access) and EXECUTIVE (read-only) can see it.
-- No other role has any policy here, so Category/Content/Design get zero access by default.
do $$
declare t text;
begin
  foreach t in array array['perf_monthly_kpi','perf_dimension','perf_top_pn','perf_uploads']
  loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format(
      'create policy %1$s_read on %1$s for select to authenticated using (public.current_app_role() in (''CRM'',''EXECUTIVE''))', t);
    execute format('drop policy if exists %1$s_crm_write on %1$s', t);
    execute format(
      'create policy %1$s_crm_write on %1$s for all to authenticated using (public.is_crm()) with check (public.is_crm())', t);
  end loop;
end $$;

-- AI cache: same read audience; written by either role's browser session since either
-- can trigger/view an analysis, but never by Category/Content/Design.
drop policy if exists perf_ai_cache_read on perf_ai_cache;
create policy perf_ai_cache_read on perf_ai_cache for select to authenticated
  using (public.current_app_role() in ('CRM','EXECUTIVE'));
drop policy if exists perf_ai_cache_write on perf_ai_cache;
create policy perf_ai_cache_write on perf_ai_cache for all to authenticated
  using (public.current_app_role() in ('CRM','EXECUTIVE'))
  with check (public.current_app_role() in ('CRM','EXECUTIVE'));

select
  (select count(*) from perf_monthly_kpi) as monthly_kpi_rows,
  (select count(*) from perf_dimension)   as dimension_rows,
  (select count(*) from perf_top_pn)      as top_pn_rows,
  (select count(*) from perf_uploads)     as uploads;
