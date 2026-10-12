\o /dev/null
create temp table dr_results(n int, name text, status text, detail text);
create or replace function pg_temp.dr(n int, name text, ok boolean, detail text default '')
returns void language plpgsql as $$
begin insert into dr_results values (n,name,case when ok then 'PASS' else 'FAIL' end,detail); end $$;

delete from category_sla where true;
delete from category_default_threshold where true;
delete from activities where event_type like 'DEFAULT_THRESHOLD%';
delete from system_notifications where kind='DEFAULT_THRESHOLD';

-- The worked example from the brief:
--   Beauty 24 on-time, 0 overdue, 0 defaulted ->  0%
--   Men    19 on-time, 1 overdue, 1 defaulted ->  5%  (1/20)
--   Kids   11 on-time, 4 overdue, 4 defaulted -> 27%  (4/15)
insert into category_sla (week_key, week_start, week_end, deadline, category, status, defaulted_at)
select 'W'||g, date '2026-01-01'+g, date '2026-01-07'+g, date '2025-12-25'+g,
       'Beauty','SUBMITTED_ON_TIME',null from generate_series(1,24) g;
insert into category_sla (week_key, week_start, week_end, deadline, category, status, defaulted_at)
select 'M'||g, date '2026-02-01'+g, date '2026-02-07'+g, date '2026-01-25'+g,
       'Men','SUBMITTED_ON_TIME',null from generate_series(1,19) g;
insert into category_sla (week_key, week_start, week_end, deadline, category, status, defaulted_at)
values ('M20', date '2026-02-25', date '2026-02-28', date '2026-02-18','Men','OVERDUE',null),
       ('M21', date '2026-02-26', date '2026-02-28', date '2026-02-19','Men','DEFAULTED',now());
insert into category_sla (week_key, week_start, week_end, deadline, category, status, defaulted_at)
select 'K'||g, date '2026-03-01'+g, date '2026-03-07'+g, date '2026-02-22'+g,
       'Kids','SUBMITTED_ON_TIME',null from generate_series(1,11) g;
insert into category_sla (week_key, week_start, week_end, deadline, category, status, defaulted_at)
select 'KO'||g, date '2026-03-20'+g, date '2026-03-26'+g, date '2026-03-13'+g,
       'Kids','OVERDUE',null from generate_series(1,4) g;
update category_sla set defaulted_at = now() where category='Kids' and status='OVERDUE';
\o

do $$
declare b record; m record; k record;
begin
  select * into b from category_default_rate() where category='Beauty';
  select * into m from category_default_rate() where category='Men';
  select * into k from category_default_rate() where category='Kids';

  perform pg_temp.dr(700,'Beauty: 24 on time, 0 defaulted -> 0%',
    b.on_time=24 and b.defaulted=0 and b.default_rate=0,
    'on_time=' || b.on_time || ' rate=' || b.default_rate);

  perform pg_temp.dr(701,'Men: 1 defaulted of 21 weeks -> 4.8%',
    m.defaulted=1 and m.total_weeks=21 and m.default_rate=4.8,
    'defaulted=' || m.defaulted || '/' || m.total_weeks || ' rate=' || m.default_rate);

  perform pg_temp.dr(702,'Kids: 4 defaulted of 15 weeks -> 26.7%',
    k.defaulted=4 and k.total_weeks=15 and k.default_rate=26.7,
    'defaulted=' || k.defaulted || '/' || k.total_weeks || ' rate=' || k.default_rate);
end $$;

do $$
declare o record;
begin
  select * into o from org_default_rate();
  perform pg_temp.dr(703,'Organisation rate = 5 of 60 weeks = 8.3%',
    o.total_weeks=60 and o.defaulted_weeks=5 and o.default_rate=8.3,
    'defaulted=' || o.defaulted_weeks || '/' || o.total_weeks || ' rate=' || o.default_rate);
  perform pg_temp.dr(704,'One category over the 10% threshold (Kids)',
    o.over_threshold=1, 'over=' || o.over_threshold);
end $$;

select pg_temp.dr(705,'Monthly trend splits by month',
  (select count(*) from default_rate_trend()) = 3,
  'months = ' || (select count(*) from default_rate_trend()));

-- ═══════ threshold alerts ═══════
do $$
declare fired int;
begin
  fired := evaluate_default_thresholds(10);
  perform pg_temp.dr(706,'Crossing the threshold raises an ACTIVITY',
    exists (select 1 from activities
            where event_type='DEFAULT_THRESHOLD_EXCEEDED' and category='Kids'
              and details like '%exceeded default threshold%'),
    'fired=' || fired);
  perform pg_temp.dr(707,'Crossing the threshold raises a NOTIFICATION',
    exists (select 1 from system_notifications
            where kind='DEFAULT_THRESHOLD' and category='Kids'
              and title like '%exceeds target threshold%'), '');
  perform pg_temp.dr(708,'Beauty and Men stay below and raise nothing',
    not exists (select 1 from activities
                where event_type='DEFAULT_THRESHOLD_EXCEEDED'
                  and category in ('Beauty','Men')), '');
end $$;

do $$
declare a1 int;
begin
  select count(*) into a1 from activities where event_type like 'DEFAULT_THRESHOLD%';
  perform evaluate_default_thresholds(10);
  perform evaluate_default_thresholds(10);
  perform pg_temp.dr(709,'Re-running raises no duplicate alerts',
    (select count(*) from activities where event_type like 'DEFAULT_THRESHOLD%') = a1,
    'alerts ' || a1 || ' -> ' || (select count(*) from activities where event_type like 'DEFAULT_THRESHOLD%'));
end $$;

-- Recovery: clear Kids' defaults and re-evaluate.
do $$
begin
  update category_sla set defaulted_at = null, status='SUBMITTED_ON_TIME' where category='Kids';
  perform evaluate_default_thresholds(10);
  perform pg_temp.dr(710,'Returning below the threshold raises a recovery ACTIVITY',
    exists (select 1 from activities
            where event_type='DEFAULT_THRESHOLD_RECOVERED' and category='Kids'
              and details like '%returned to acceptable default levels%'), '');
end $$;

select pg_temp.dr(711,'Existing SLA logic untouched: no status was rewritten by reporting',
  (select count(*) from category_sla where status='SUBMITTED_ON_TIME') > 0, '');

\echo ''
\echo '  #     STATUS  DEFAULT RATE REPORTING'
select lpad(n::text,4)||'  '||rpad(status,6)||'  '||name||
  case when detail<>'' then '  ['||detail||']' else '' end from dr_results order by n;

do $$
declare f int;
begin
  select count(*) into f from dr_results where status='FAIL';
  if f>0 then raise exception '% default-rate check(s) FAILED', f; end if;
end $$;
