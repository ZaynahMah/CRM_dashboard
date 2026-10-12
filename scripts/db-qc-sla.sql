\o /dev/null
create temp table sla_results(n int, name text, status text, detail text);
create or replace function pg_temp.schk(n int, name text, ok boolean, detail text default '')
returns void language plpgsql as $$
begin insert into sla_results values (n,name,case when ok then 'PASS' else 'FAIL' end,detail); end $$;

insert into auth.users (id,email) values
 ('11111111-1111-4111-8111-111111111111','crm@internal.local') on conflict do nothing;
update profiles set role='CRM' where id='11111111-1111-4111-8111-111111111111';
delete from category_sla where true;
delete from activities where true;
delete from system_notifications where true;
delete from campaigns where true;
\o

-- ═══════ the SQL week functions must match businessWeeks.ts exactly ═══════
select pg_temp.schk(500,'Week buckets: 1-7, 8-14, 15-21, 22-28, 29-end',
  public.business_week_key(date '2026-11-01')='2026-11-W1'
  and public.business_week_key(date '2026-11-07')='2026-11-W1'
  and public.business_week_key(date '2026-11-08')='2026-11-W2'
  and public.business_week_key(date '2026-11-15')='2026-11-W3'
  and public.business_week_key(date '2026-11-22')='2026-11-W4'
  and public.business_week_key(date '2026-11-29')='2026-11-W5',
  '1 Nov=' || public.business_week_key(date '2026-11-01')
  || ' 29 Nov=' || public.business_week_key(date '2026-11-29'));

select pg_temp.schk(501,'W5 runs to month end (Feb and Nov)',
  public.business_week_end(date '2026-11-30')=date '2026-11-30'
  and public.business_week_end(date '2026-02-28')=date '2026-02-28',
  'Nov=' || public.business_week_end(date '2026-11-30')
  || ' Feb=' || public.business_week_end(date '2026-02-28'));

select pg_temp.schk(502,'THE deadline rule: 1 Nov–7 Nov -> 25 Oct',
  public.category_week_deadline(date '2026-11-01')=date '2026-10-25'
  and public.category_week_deadline(date '2026-11-07')=date '2026-10-25',
  '1 Nov -> ' || public.category_week_deadline(date '2026-11-01'));

select pg_temp.schk(503,'Every campaign in a week inherits the SAME deadline',
  public.category_week_deadline(date '2026-11-01')
  = public.category_week_deadline(date '2026-11-05'),
  'deadline is per week, not per campaign');

-- ═══════ seed one week of Kids campaigns, none submitted ═══════
\o /dev/null
insert into campaigns (campaign_name, campaign_origin, launch_date, slot_type, category, created_by)
select 'Kids PN '||g,'CRM_PLANNED'::campaign_origin, date '2026-11-01'+(g%7),'STANDARD','Kids',
       '11111111-1111-4111-8111-111111111111'
from generate_series(1,6) g;
insert into campaigns (campaign_name, campaign_origin, launch_date, slot_type, category,
                       category_status, created_by)
select 'Beauty PN '||g,'CRM_PLANNED'::campaign_origin, date '2026-11-01'+(g%7),'STANDARD','Beauty',
       'LOCKED'::category_status,'11111111-1111-4111-8111-111111111111'
from generate_series(1,4) g;
\o

-- ═══════ progression: 0 overdue, 1 reminder, 2 escalation, 3 defaulted ═══════
do $$
declare st text;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);

  perform recalculate_category_sla(date '2026-10-24');
  select status into st from category_sla where category='Kids';
  perform pg_temp.schk(504,'Day -1 -> DUE_SOON', st='DUE_SOON', 'got ' || st);

  perform recalculate_category_sla(date '2026-10-25');
  select status into st from category_sla where category='Kids';
  perform pg_temp.schk(505,'Day 0 -> OVERDUE (not Defaulted)', st='OVERDUE', 'got ' || st);

  perform recalculate_category_sla(date '2026-10-26');
  select status into st from category_sla where category='Kids';
  perform pg_temp.schk(506,'Day 1 -> REMINDER', st='REMINDER', 'got ' || st);

  perform recalculate_category_sla(date '2026-10-27');
  select status into st from category_sla where category='Kids';
  perform pg_temp.schk(507,'Day 2 -> ESCALATION', st='ESCALATION', 'got ' || st);

  perform recalculate_category_sla(date '2026-10-28');
  select status into st from category_sla where category='Kids';
  perform pg_temp.schk(508,'Day 3 -> DEFAULTED', st='DEFAULTED', 'got ' || st);

  perform pg_temp.schk(509,'defaulted_at recorded once',
    (select defaulted_at is not null from category_sla where category='Kids'), '');

  select status into st from category_sla where category='Beauty';
  perform pg_temp.schk(510,'A fully submitted category is SUBMITTED_ON_TIME',
    st='SUBMITTED_ON_TIME', 'got ' || st);
end $$;

-- ═══════ activities and notifications are SEPARATE and populated ═══════
select pg_temp.schk(511,'Activities recorded for the default',
  exists (select 1 from activities where event_type='DEFAULTED' and category='Kids'),
  'activities rows = ' || (select count(*) from activities));

select pg_temp.schk(512,'Notifications recorded, separate table from activities',
  exists (select 1 from system_notifications where kind='DEADLINE_MISSED' and category='Kids')
  and (select count(*) from system_notifications) > 0,
  'notifications = ' || (select count(*) from system_notifications));

select pg_temp.schk(513,'The existing per-role notifications table is untouched',
  (select count(*) from notifications) = 0, 'legacy notifications = ' || (select count(*) from notifications));

-- ═══════ idempotence: rerunning writes no duplicates ═══════
do $$
declare a1 int; a2 int; n1 int; n2 int;
begin
  select count(*) into a1 from activities;
  select count(*) into n1 from system_notifications;
  perform recalculate_category_sla(date '2026-10-28');
  perform recalculate_category_sla(date '2026-10-28');
  select count(*) into a2 from activities;
  select count(*) into n2 from system_notifications;
  perform pg_temp.schk(514,'Re-running the nightly job creates no duplicates',
    a1=a2 and n1=n2, 'activities ' || a1 || '->' || a2 || ', notifications ' || n1 || '->' || n2);
end $$;

-- ═══════ CRM override ═══════
do $$
declare sid uuid; st text; blocked boolean := false;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select id into sid from category_sla where category='Kids';
  perform record_crm_sla_override(sid);
  select status into st from category_sla where id=sid;
  perform pg_temp.schk(515,'CRM override sets CRM_FILLED_AFTER_DEFAULT',
    st='CRM_FILLED_AFTER_DEFAULT', 'got ' || st);
  perform pg_temp.schk(516,'Override records who and when',
    (select crm_filled_by is not null and crm_filled_at is not null from category_sla where id=sid), '');
  perform pg_temp.schk(517,'Override logged to activities AND notifications',
    exists (select 1 from activities where event_type='CRM_OVERRIDE' and category='Kids')
    and exists (select 1 from system_notifications where kind='CRM_OVERRIDE' and category='Kids'), '');

  -- Not allowed before a default.
  select id into sid from category_sla where category='Beauty';
  begin perform record_crm_sla_override(sid); exception when others then blocked := true; end;
  perform pg_temp.schk(518,'Override refused for a week that has not defaulted', blocked, '');
end $$;

-- ═══════ a default must NOT block campaign movement ═══════
do $$
declare moved boolean := false;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  update campaigns set crm_status='SENT_TO_CONTENT', content_status='PENDING'
   where category='Kids';
  moved := (select count(*) from campaigns where category='Kids' and content_status='PENDING') = 6;
  perform pg_temp.schk(519,'A defaulted week does not block campaign movement', moved,
    'moved ' || (select count(*) from campaigns where category='Kids' and content_status='PENDING') || ' of 6');
end $$;

-- ═══════ executive summary ═══════
do $$
declare s record;
begin
  select * into s from category_sla_summary();
  perform pg_temp.schk(520,'Executive summary counts are consistent',
    s.total = (select count(*) from category_sla)
    and s.crm_overrides = 1 and s.defaults_created >= 1,
    'total=' || s.total || ' on_time=' || s.on_time || ' overrides=' || s.crm_overrides
    || ' defaults=' || s.defaults_created);
  perform pg_temp.schk(521,'Trend and offenders return rows',
    (select count(*) from category_sla_trend()) > 0
    and (select count(*) from category_sla_offenders()) > 0,
    'trend=' || (select count(*) from category_sla_trend())
    || ' offenders=' || (select count(*) from category_sla_offenders()));
end $$;

-- ═══════ reset rebuilds SLA data, does not destroy the log ═══════
do $$
declare before_act int; after_sla int;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select count(*) into before_act from activities;
  perform reset_campaigns_with_archive(
    '[{"campaign_name":"new","launch_date":"2026-12-02","category":"Home"}]'::jsonb, false);
  perform recalculate_category_sla(date '2026-11-30');
  select count(*) into after_sla from category_sla where category='Home';
  perform pg_temp.schk(522,'After a reset the SLA rebuilds for the new sheet',
    after_sla = 1, 'Home SLA rows = ' || after_sla);
  perform pg_temp.schk(523,'A campaign reset does not delete the activity log',
    (select count(*) from activities) >= before_act,
    'activities ' || before_act || ' -> ' || (select count(*) from activities));
end $$;

\echo ''
\echo '  #     STATUS  CATEGORY SLA / ACTIVITIES / NOTIFICATIONS'
select lpad(n::text,4)||'  '||rpad(status,6)||'  '||name||
  case when detail<>'' then '  ['||detail||']' else '' end from sla_results order by n;

do $$
declare f int;
begin
  select count(*) into f from sla_results where status='FAIL';
  if f>0 then raise exception '% SLA check(s) FAILED', f; end if;
end $$;
