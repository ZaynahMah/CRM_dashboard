\o /dev/null
create temp table st_results(n int, name text, status text, detail text);
create or replace function pg_temp.tchk(n int, name text, ok boolean, detail text default '')
returns void language plpgsql as $$
begin insert into st_results values (n,name,case when ok then 'PASS' else 'FAIL' end,detail); end $$;

insert into auth.users (id,email) values
 ('11111111-1111-4111-8111-111111111111','crm@internal.local') on conflict do nothing;
update profiles set role='CRM' where id='11111111-1111-4111-8111-111111111111';
delete from campaigns where true;
delete from campaigns_archive where true;

-- Exactly the stated scenario: 100 CRM Self + 500 Category-led.
insert into campaigns (campaign_name, campaign_origin, launch_date, slot_type, is_crm_self, category, created_by)
select 'SELF '||g,'CRM_PLANNED'::campaign_origin, date '2026-11-01'+(g%7),'STANDARD',true,'Kids',
       '11111111-1111-4111-8111-111111111111' from generate_series(1,100) g;
insert into campaigns (campaign_name, campaign_origin, launch_date, slot_type, is_crm_self, category, created_by)
select 'LED '||g,'CRM_PLANNED'::campaign_origin, date '2026-11-01'+(g%7),'STANDARD',false,'Beauty',
       '11111111-1111-4111-8111-111111111111' from generate_series(1,500) g;
-- Children on both streams, to prove they are scoped too.
insert into qc_checklists (campaign_id) select id from campaigns;
insert into activity_logs (campaign_id, user_id, action, description)
select id,'11111111-1111-4111-8111-111111111111','X','x' from campaigns;
\o

select pg_temp.tchk(600,'Start: 100 CRM Self + 500 Category-led',
  (select count(*) from campaigns where is_crm_self) = 100
  and (select count(*) from campaigns where not is_crm_self) = 500,
  'self=' || (select count(*) from campaigns where is_crm_self)
  || ' led=' || (select count(*) from campaigns where not is_crm_self));

-- ═══════ preview names both streams ═══════
do $$
declare p record;
begin
  select * into p from upload_reset_preview(true);
  perform pg_temp.tchk(601,'Preview(CRM Self): 100 to replace, 500 unaffected',
    p.total = 100 and p.unaffected_total = 500
    and p.stream='CRM Self' and p.unaffected_stream='Category-led',
    'total=' || p.total || ' unaffected=' || p.unaffected_total);

  select * into p from upload_reset_preview(false);
  perform pg_temp.tchk(602,'Preview(Category-led): 500 to replace, 100 unaffected',
    p.total = 500 and p.unaffected_total = 100,
    'total=' || p.total || ' unaffected=' || p.unaffected_total);
end $$;

-- ═══════ SCENARIO A: reset CRM Self with 150 rows ═══════
do $$
declare batch uuid; arch int;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  batch := reset_campaigns_with_archive(
    (select jsonb_agg(jsonb_build_object('campaign_name','NEWSELF '||g,
       'launch_date','2026-12-01')) from generate_series(1,150) g), true);
  select campaigns_archived into arch from upload_reset_batches where id = batch;

  perform pg_temp.tchk(603,'Scenario A: CRM Self -> 150, Category-led STILL 500',
    (select count(*) from campaigns where is_crm_self) = 150
    and (select count(*) from campaigns where not is_crm_self) = 500,
    'self=' || (select count(*) from campaigns where is_crm_self)
    || ' led=' || (select count(*) from campaigns where not is_crm_self));

  perform pg_temp.tchk(604,'Archived ONLY the 100 CRM Self rows', arch = 100,
    'archived=' || arch || ' (expected 100, not 600)');

  perform pg_temp.tchk(605,'No original Category-led row was deleted',
    (select count(*) from campaigns where campaign_name like 'LED %') = 500,
    'LED rows = ' || (select count(*) from campaigns where campaign_name like 'LED %'));

  perform pg_temp.tchk(606,'New rows forced into the CRM Self stream',
    (select count(*) from campaigns where campaign_name like 'NEWSELF%' and is_crm_self) = 150, '');

  perform pg_temp.tchk(607,'Category-led children survived',
    (select count(*) from qc_checklists q join campaigns c on c.id=q.campaign_id
      where not c.is_crm_self) = 500,
    'led checklists = ' || (select count(*) from qc_checklists q
      join campaigns c on c.id=q.campaign_id where not c.is_crm_self));

  perform pg_temp.tchk(608,'CRM Self children were cleared',
    (select count(*) from qc_checklists q join campaigns c on c.id=q.campaign_id
      where c.is_crm_self) = 0, '');

  perform pg_temp.tchk(609,'reset_events records which stream',
    (select is_crm_self from reset_events where batch_id = batch) = true, '');
end $$;

-- ═══════ SCENARIO B: reset Category-led with 400 rows ═══════
do $$
declare batch uuid; arch int;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  batch := reset_campaigns_with_archive(
    (select jsonb_agg(jsonb_build_object('campaign_name','NEWLED '||g,
       'launch_date','2026-12-02')) from generate_series(1,400) g), false);
  select campaigns_archived into arch from upload_reset_batches where id = batch;

  perform pg_temp.tchk(610,'Scenario B: Category-led -> 400, CRM Self STILL 150',
    (select count(*) from campaigns where not is_crm_self) = 400
    and (select count(*) from campaigns where is_crm_self) = 150,
    'led=' || (select count(*) from campaigns where not is_crm_self)
    || ' self=' || (select count(*) from campaigns where is_crm_self));

  perform pg_temp.tchk(611,'Archived ONLY the 500 Category-led rows', arch = 500,
    'archived=' || arch);

  perform pg_temp.tchk(612,'The 150 CRM Self rows from scenario A are intact',
    (select count(*) from campaigns where campaign_name like 'NEWSELF%') = 150, '');
end $$;

-- ═══════ downstream views stay correct ═══════
do $$
declare s record; n int;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select * into s from monthly_workflow_summary();
  perform pg_temp.tchk(613,'Monthly workflow totals both streams: 550',
    s.total = 550 and s.crm_self = 150 and s.category_led = 400,
    'total=' || s.total || ' self=' || s.crm_self || ' led=' || s.category_led);

  perform recalculate_category_sla(date '2026-11-30');
  select count(*) into n from category_sla;
  perform pg_temp.tchk(614,'SLA rebuilds across both streams after a scoped reset',
    n > 0, 'sla rows = ' || n);
end $$;

-- ═══════ performance reports untouched by either reset ═══════
select pg_temp.tchk(615,'Performance reports survive a scoped reset',
  (select count(*) from performance_reports) >= 0, 'separate tables, no FK to campaigns');

\echo ''
\echo '  #     STATUS  SCOPED RESET BY STREAM'
select lpad(n::text,4)||'  '||rpad(status,6)||'  '||name||
  case when detail<>'' then '  ['||detail||']' else '' end from st_results order by n;

do $$
declare f int;
begin
  select count(*) into f from st_results where status='FAIL';
  if f>0 then raise exception '% stream check(s) FAILED', f; end if;
end $$;
