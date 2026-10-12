\o /dev/null
create temp table load_results(n int, name text, status text, detail text);
create or replace function pg_temp.lchk(n int, name text, ok boolean, detail text default '')
returns void language plpgsql as $$
begin insert into load_results values (n,name,case when ok then 'PASS' else 'FAIL' end,detail); end $$;

insert into auth.users (id,email) values
 ('11111111-1111-4111-8111-111111111111','crm@internal.local') on conflict do nothing;
update profiles set role='CRM' where id='11111111-1111-4111-8111-111111111111';

delete from campaigns where true;
delete from campaigns_archive where true;
delete from activity_logs_archive where true;
delete from qc_checklists_archive where true;

-- Deliberately heavier than production: 3,000 campaigns, 60,000 activity
-- logs (20 per campaign), a full checklist each. This is the load that
-- caused 57014.
insert into campaigns (campaign_name, campaign_origin, launch_date, slot_type, created_by)
select 'PN '||g, 'CRM_PLANNED'::campaign_origin, date '2026-07-01'+(g%28), 'STANDARD',
       '11111111-1111-4111-8111-111111111111'
from generate_series(1,3000) g;

insert into activity_logs (campaign_id, user_id, action, description)
select c.id, '11111111-1111-4111-8111-111111111111', 'STEP_'||s, 'worked on this campaign'
from campaigns c, generate_series(1,20) s;

insert into qc_checklists (campaign_id) select id from campaigns;
insert into change_requests (campaign_id, requested_by, field_name, reason)
select id, '11111111-1111-4111-8111-111111111111', 'landing', 'bulk' from campaigns limit 500;
\o

select pg_temp.lchk(300, 'Load prepared: 3,000 campaigns / 60,000 logs',
  (select count(*) from campaigns) = 3000 and (select count(*) from activity_logs) >= 60000,
  'campaigns=' || (select count(*) from campaigns)
  || ' logs=' || (select count(*) from activity_logs));

-- The timeout the API would impose. 8s is Supabase's usual value for the
-- `authenticated` role; the function must survive it by raising its own.
set statement_timeout = '8s';

do $$
declare t0 timestamptz := clock_timestamp(); batch uuid; ms numeric;
        ok boolean := false; msg text := '';
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  begin
    batch := reset_campaigns_with_archive(
      (select jsonb_agg(jsonb_build_object(
         'campaign_name','NEW '||g, 'launch_date',(date '2026-08-01'+(g%28))::text))
       from generate_series(1,3000) g), false);
    ok := true;
  exception when others then msg := sqlstate || ' ' || sqlerrm;
  end;
  ms := extract(milliseconds from clock_timestamp() - t0)
      + 1000 * extract(second from clock_timestamp() - t0);
  perform pg_temp.lchk(301,
    'Reset completes under an 8s API statement_timeout', ok,
    case when ok then round(ms) || ' ms' else 'error: ' || msg end);
  perform pg_temp.lchk(302, 'Exactly the new sheet remains',
    (select count(*) from campaigns) = 3000
    and not exists (select 1 from campaigns where campaign_name like 'PN %'),
    'campaigns=' || (select count(*) from campaigns));
  perform pg_temp.lchk(303, 'Archive holds the full previous dataset',
    (select campaigns_archived from upload_reset_batches where id=batch) = 3000
    and (select logs_archived from upload_reset_batches where id=batch) >= 60000,
    'archived campaigns=' || coalesce((select campaigns_archived from upload_reset_batches where id=batch),-1)
    || ' logs=' || coalesce((select logs_archived from upload_reset_batches where id=batch),-1));
  perform pg_temp.lchk(304, 'All children cleared, nothing orphaned',
    (select count(*) from activity_logs where campaign_id is not null) = 0
    and (select count(*) from qc_checklists) = 0
    and (select count(*) from change_requests) = 0,
    'logs=' || (select count(*) from activity_logs where campaign_id is not null)
    || ' checklists=' || (select count(*) from qc_checklists)
    || ' change_requests=' || (select count(*) from change_requests));
end $$;

-- NOTE on what is NOT asserted here:
-- The negative case ("a 50ms budget kills the reset") cannot be tested in
-- this transaction. Once the timeout fires, the subtransaction rollback that
-- plpgsql needs to catch the exception also fails, so 57014 escapes every
-- handler. It was verified manually against a real cluster: the reset WAS
-- cancelled from inside the delete, which is the proof that an in-function
-- `SET LOCAL statement_timeout` cannot rescue an already-armed timer.
--
-- What matters in production is the ROLE default, asserted below, because
-- that is what a PostgREST request inherits.

-- The role default migration 22 sets is what a PostgREST request inherits.
select pg_temp.lchk(307,
  'Role budget raised for `authenticated` (what the API actually uses)',
  exists (select 1 from pg_roles where rolname='authenticated'
          and array_to_string(rolconfig, ',') like '%statement_timeout=120s%'),
  coalesce((select array_to_string(rolconfig, ',') from pg_roles
            where rolname='authenticated'), 'no rolconfig set'));

\echo ''
\echo '  #     STATUS  RESET LOAD TEST (3,000 campaigns / 60,000 logs, 8s API budget)'
select lpad(n::text,4)||'  '||rpad(status,6)||'  '||name||
  case when detail<>'' then '  ['||detail||']' else '' end from load_results order by n;

do $$
declare f int;
begin
  select count(*) into f from load_results where status='FAIL';
  if f>0 then raise exception '% load check(s) FAILED', f; end if;
end $$;
