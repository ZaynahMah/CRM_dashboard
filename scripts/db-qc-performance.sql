\o /dev/null
create temp table perf_results(n int, name text, status text, detail text);
create or replace function pg_temp.pchk(n int, name text, ok boolean, detail text default '')
returns void language plpgsql as $$
begin insert into perf_results values (n,name,case when ok then 'PASS' else 'FAIL' end,detail); end $$;

insert into auth.users (id,email) values
 ('44444444-4444-4444-8444-444444444444','executive@internal.local'),
 ('11111111-1111-4111-8111-111111111111','crm@internal.local') on conflict do nothing;
update profiles set role='EXECUTIVE' where id='44444444-4444-4444-8444-444444444444';
update profiles set role='CRM'       where id='11111111-1111-4111-8111-111111111111';
delete from performance_reports where true;
\o

-- ═══════ upload two reports; the newest must be the only current one ═══════
do $$
declare r1 uuid; r2 uuid; n_current int;
begin
  perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);

  insert into performance_reports (file_name, uploaded_by, sheets_found, sheet_count, current_month, row_count)
  values ('october.xlsx','44444444-4444-4444-8444-444444444444',
          array['Monthly_KPI','Category_Performance'],2,'Oct 2026',120) returning id into r1;
  insert into performance_monthly_kpi (report_id, month, platform, visits, orders, revenue_inr, cvr)
  values (r1,'Oct 2026','App',1000,50,250000,0.05);
  insert into performance_dimensions (report_id, sheet_key, month, dimension_value, revenue_inr)
  values (r1,'category','Oct 2026','Westside',90000);
  insert into performance_top_pn (report_id, pn_name, rank, revenue_inr) values (r1,'PN A',1,50000);
  perform set_current_performance_report(r1);

  insert into performance_reports (file_name, uploaded_by, sheets_found, sheet_count, current_month, row_count)
  values ('november.xlsx','44444444-4444-4444-8444-444444444444',
          array['Monthly_KPI'],1,'Nov 2026',80) returning id into r2;
  insert into performance_monthly_kpi (report_id, month, platform, visits)
  values (r2,'Nov 2026','App',2000);
  perform set_current_performance_report(r2);

  select count(*) into n_current from performance_reports where is_current;

  perform pg_temp.pchk(400,'A second upload replaces the first as Current',
    n_current = 1 and (select file_name from performance_reports where is_current) = 'november.xlsx',
    'current count=' || n_current
    || ' file=' || (select file_name from performance_reports where is_current));

  perform pg_temp.pchk(401,'Version history keeps the previous upload as Archived',
    (select count(*) from performance_reports) = 2
    and (select count(*) from performance_reports where not is_current) = 1,
    'reports=' || (select count(*) from performance_reports));

  -- Restore the first report. Called as its own statement: wrapping it in a
  -- subquery left the evaluation order of the assertion undefined.
  perform set_current_performance_report(r1);
  perform pg_temp.pchk(402,'Restoring an older version flips Current back, metrics intact',
    (select file_name from performance_reports where is_current) = 'october.xlsx'
    and (select count(*) from performance_reports where is_current) = 1
    and (select count(*) from performance_monthly_kpi where report_id = r1) = 1
    and (select count(*) from performance_dimensions where report_id = r1) = 1
    and (select count(*) from performance_top_pn where report_id = r1) = 1,
    'current=' || (select file_name from performance_reports where is_current)
    || ' kpi=' || (select count(*) from performance_monthly_kpi where report_id = r1));
end $$;

-- ═══════ only one current, enforced by the DATABASE not by convention ═══════
do $$
declare blocked boolean := false;
begin
  begin
    update performance_reports set is_current = true where true;
  exception when others then blocked := true; end;
  perform pg_temp.pchk(403,'Database refuses two current reports at once', blocked,
    'partial unique index must reject it');
end $$;

-- ═══════ access control ═══════
do $$
declare crm_blocked boolean := false; crm_can_read boolean := false; n int;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  set local role authenticated;
  begin
    insert into performance_reports (file_name) values ('crm-sneaks-in.xlsx');
  exception when others then crm_blocked := true; end;
  select count(*) into n from performance_reports;
  crm_can_read := n > 0;
  reset role;

  perform pg_temp.pchk(404,'CRM cannot upload a performance report', crm_blocked, '');
  perform pg_temp.pchk(405,'CRM CAN view the dashboard data', crm_can_read,
    'CRM sees ' || n || ' reports');
end $$;

do $$
declare exec_ok boolean := false;
begin
  perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
  set local role authenticated;
  begin
    insert into performance_reports (file_name) values ('exec-upload.xlsx');
    exec_ok := true;
  exception when others then exec_ok := false; end;
  reset role;
  perform pg_temp.pchk(406,'EXECUTIVE can upload', exec_ok, '');
  delete from performance_reports where file_name = 'exec-upload.xlsx';
end $$;

-- ═══════ THE CRITICAL ONE: a campaign reset must not touch reports ═══════
do $$
declare before_reports int; after_reports int; before_metrics int; after_metrics int;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  delete from campaigns where true;
  insert into campaigns (campaign_name, campaign_origin, launch_date, slot_type, created_by)
  select 'PN '||g,'CRM_PLANNED'::campaign_origin, date '2026-07-01','STANDARD',
         '11111111-1111-4111-8111-111111111111'
  from generate_series(1,20) g;

  select count(*) into before_reports from performance_reports;
  select count(*) into before_metrics from performance_monthly_kpi;

  perform reset_campaigns_with_archive(
    '[{"campaign_name":"after reset","launch_date":"2026-08-01"}]'::jsonb, false);

  select count(*) into after_reports from performance_reports;
  select count(*) into after_metrics from performance_monthly_kpi;

  perform pg_temp.pchk(407,
    'Campaign reset does NOT delete performance reports or metrics',
    before_reports = after_reports and before_metrics = after_metrics
    and after_reports > 0,
    'reports ' || before_reports || '->' || after_reports
    || ', metrics ' || before_metrics || '->' || after_metrics);

  perform pg_temp.pchk(408,'The campaign reset itself still worked',
    (select count(*) from campaigns) = 1, 'campaigns=' || (select count(*) from campaigns));
end $$;

-- ═══════ metrics follow their report when it is deleted ═══════
do $$
declare doomed uuid; left_over int;
begin
  perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
  insert into performance_reports (file_name) values ('to-delete.xlsx') returning id into doomed;
  insert into performance_monthly_kpi (report_id, month) values (doomed,'X');
  delete from performance_reports where id = doomed;
  select count(*) into left_over from performance_monthly_kpi where report_id = doomed;
  perform pg_temp.pchk(409,'Deleting a report cascades its metrics', left_over = 0,
    'orphaned metric rows = ' || left_over);
end $$;

\echo ''
\echo '  #     STATUS  PERFORMANCE PERSISTENCE'
select lpad(n::text,4)||'  '||rpad(status,6)||'  '||name||
  case when detail<>'' then '  ['||detail||']' else '' end from perf_results order by n;

do $$
declare f int;
begin
  select count(*) into f from perf_results where status='FAIL';
  if f>0 then raise exception '% performance check(s) FAILED', f; end if;
end $$;
