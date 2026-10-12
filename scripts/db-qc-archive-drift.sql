\o /dev/null
create temp table drift_results(n int, name text, status text, detail text);
create or replace function pg_temp.dchk(n int, name text, ok boolean, detail text default '')
returns void language plpgsql as $$
begin insert into drift_results values (n, name, case when ok then 'PASS' else 'FAIL' end, detail); end $$;

-- Simulate the live situation: an archive table created BEFORE the six
-- tracking_* columns existed. Dropping them from the archive reproduces
-- exactly the shape a pre-16 run of migration 18 would have left.
alter table campaigns_archive drop column if exists tracking_category;
alter table campaigns_archive drop column if exists tracking_sub_category;
alter table campaigns_archive drop column if exists tracking_brand;
alter table campaigns_archive drop column if exists tracking_offer;
alter table campaigns_archive drop column if exists tracking_landing;
alter table campaigns_archive drop column if exists campaign_name_code;
\o

select pg_temp.dchk(200, 'Archive made stale on purpose (6 columns short)',
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='campaigns')
  - (select count(*) from information_schema.columns
     where table_schema='public' and table_name='campaigns_archive') = 3,
  'campaigns - archive = ' ||
   ((select count(*) from information_schema.columns where table_schema='public' and table_name='campaigns')
  - (select count(*) from information_schema.columns where table_schema='public' and table_name='campaigns_archive'))::text
  || ' (should be 3 only after the fix; 9 while stale)');

\o /dev/null
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','crm@internal.local') on conflict do nothing;
update profiles set role='CRM' where id='11111111-1111-4111-8111-111111111111';
insert into campaigns (campaign_name, campaign_origin, launch_date, created_by)
select 'drift ' || g, 'CRM_PLANNED'::campaign_origin, date '2026-07-01',
       '11111111-1111-4111-8111-111111111111'
from generate_series(1,5) g;
\o

-- With the stale archive, the reset MUST now still succeed, because
-- migration 21 re-aligned the shape and made the insert name-based.
do $$
declare batch uuid; ok boolean := false; msg text := '';
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  begin
    batch := reset_campaigns_with_archive(
      '[{"campaign_name":"after-drift","launch_date":"2026-07-02"}]'::jsonb, false);
    ok := true;
  exception when others then msg := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.dchk(201,
    'Reset succeeds despite a stale archive table (was 42601)', ok,
    case when ok then 'batch written' else 'error: ' || msg end);
  perform pg_temp.dchk(202, 'New sheet is the only data after the reset',
    (select count(*) from campaigns) = 1,
    'campaigns = ' || (select count(*) from campaigns));
end $$;

\echo ''
\echo '  #     STATUS  ARCHIVE DRIFT REGRESSION'
select lpad(n::text,4) || '  ' || rpad(status,6) || '  ' || name ||
       case when detail <> '' then '  [' || detail || ']' else '' end
from drift_results order by n;

do $$
declare f int;
begin
  select count(*) into f from drift_results where status='FAIL';
  if f > 0 then raise exception '% archive-drift check(s) FAILED', f; end if;
end $$;
