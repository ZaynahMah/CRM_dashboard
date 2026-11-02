RUN 1 OF 7 — READ-ONLY CHECKS. Paste and run alone. Changes nothing.

select
  (select count(*) from campaigns)      as campaigns_before,
  (select count(*) from notifications)  as notifications_before,
  (select count(*) from upload_batches) as upload_batches_before;

select c.conrelid::regclass::text as child_table,
       a.attname as column_name,
       case c.confdeltype when 'c' then 'CASCADE' when 'a' then 'NO ACTION'
            when 'n' then 'SET NULL' when 'r' then 'RESTRICT' end as on_delete,
       exists (select 1 from pg_index i where i.indrelid = c.conrelid
               and a.attnum = any(i.indkey)) as column_indexed
from pg_constraint c
join unnest(c.conkey) ck on true
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = ck
where c.contype = 'f' and c.confrelid = 'campaigns'::regclass
order by 1;

select launch_date,
       count(*) as total_pns,
       count(*) filter (where calendar_status = 'UPDATED') as on_calendar,
       count(*) filter (where calendar_status is distinct from 'UPDATED') as blocking
from campaigns
group by launch_date
order by launch_date;

select c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
       pg_size_pretty(pg_relation_size(c.oid))       as table_only,
       pg_size_pretty(pg_indexes_size(c.oid))        as indexes,
       n_live_tup, n_dead_tup
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 25;

select count(*) as bad_enum_literals from public.check_trigger_enum_literals();


RUN 2 OF 7 — THE MISSING INDEX AND THE AUDIT TABLE. Adds only.

create index if not exists notifications_campaign_idx
  on notifications (campaign_id) where campaign_id is not null;

create table if not exists day_delete_audit (
  id              uuid primary key default gen_random_uuid(),
  launch_date     date not null,
  performed_by    uuid references profiles(id),
  performed_name  text not null,
  campaigns_removed integer not null default 0,
  children_removed  jsonb,
  backup_sha256   text not null,
  backup_name     text,
  created_at      timestamptz not null default now()
);

alter table day_delete_audit enable row level security;

drop policy if exists day_delete_audit_read on day_delete_audit;
create policy day_delete_audit_read on day_delete_audit
  for select to authenticated using (public.is_crm());


RUN 3 OF 7 — ELIGIBILITY, READ-ONLY.

create or replace function public.day_delete_status(p_day date)
returns table (
  launch_date date,
  total_pns integer,
  on_calendar integer,
  blocking integer,
  still_with_category integer,
  still_with_content integer,
  pending_crm integer,
  eligible boolean
) language sql stable security definer set search_path = public as $$
  select
    p_day,
    count(*)::int,
    count(*) filter (where calendar_status = 'UPDATED')::int,
    count(*) filter (where calendar_status is distinct from 'UPDATED')::int,
    count(*) filter (where calendar_status is distinct from 'UPDATED'
                       and category_status in ('EMPTY','DRAFT'))::int,
    count(*) filter (where calendar_status is distinct from 'UPDATED'
                       and content_status in ('PENDING','NEEDS_CHANGES'))::int,
    count(*) filter (where calendar_status is distinct from 'UPDATED'
                       and content_status = 'SUBMITTED')::int,
    count(*) > 0 and count(*) filter (where calendar_status is distinct from 'UPDATED') = 0
  from campaigns
  where launch_date = p_day;
$$;
grant execute on function public.day_delete_status(date) to authenticated;

create or replace function public.day_delete_blockers(p_day date)
returns table (id uuid, campaign_name text, slot_label text,
               category_status text, content_status text, qc_status text)
language sql stable security definer set search_path = public as $$
  select c.id, c.campaign_name, c.slot_label,
         c.category_status::text, c.content_status::text, c.qc_status::text
  from campaigns c
  where c.launch_date = p_day
    and c.calendar_status is distinct from 'UPDATED'
  order by c.slot_number nulls last, c.campaign_name;
$$;
grant execute on function public.day_delete_blockers(date) to authenticated;

create or replace function public.day_delete_signature(p_day date)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    encode(sha256(convert_to(
      coalesce(string_agg(c.id::text || ':' || coalesce(c.updated_at::text,''),
                          '|' order by c.id), ''), 'UTF8')), 'hex'), '')
  from campaigns c where c.launch_date = p_day;
$$;
grant execute on function public.day_delete_signature(date) to authenticated;


RUN 4 OF 7 — THE DELETE. One day, one transaction. Nothing runs at install.

create or replace function public.delete_finished_day(
  p_day date,
  p_backup_sha text,
  p_backup_name text,
  p_by_name text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_removed integer := 0;
  v_children jsonb;
  v_sig text;
begin
  if public.is_crm() is not true then
    raise exception 'Only CRM can delete a day.';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Your name is required to delete a day.';
  end if;
  if coalesce(btrim(p_backup_sha), '') = '' then
    raise exception 'A backup must be downloaded before a day can be deleted.';
  end if;

  perform 1 from campaigns where launch_date = p_day for update;

  select array_agg(id order by id) into v_ids
  from campaigns where launch_date = p_day;

  if v_ids is null then
    raise exception 'No PNs exist for %.', p_day;
  end if;

  if exists (select 1 from campaigns
             where launch_date = p_day
               and calendar_status is distinct from 'UPDATED') then
    raise exception
      'Not ready: % PN(s) for % are not on the calendar.',
      (select count(*) from campaigns where launch_date = p_day
        and calendar_status is distinct from 'UPDATED'), p_day;
  end if;

  v_sig := public.day_delete_signature(p_day);
  if v_sig is distinct from p_backup_sha then
    raise exception 'The data changed since your preview. Run the preview and backup again.';
  end if;

  select jsonb_build_object(
    'activity_logs',       (select count(*) from activity_logs       where campaign_id = any(v_ids)),
    'notifications',       (select count(*) from notifications       where campaign_id = any(v_ids)),
    'qc_checklists',       (select count(*) from qc_checklists       where campaign_id = any(v_ids)),
    'change_requests',     (select count(*) from change_requests     where campaign_id = any(v_ids)),
    'crm_decisions',       (select count(*) from crm_decisions       where campaign_id = any(v_ids)),
    'content_change_sets', (select count(*) from content_change_sets where campaign_id = any(v_ids)),
    'content_submissions', (select count(*) from content_submissions where campaign_id = any(v_ids))
  ) into v_children;

  perform public.begin_system_write();

  delete from notifications       where campaign_id = any(v_ids);
  delete from activity_logs       where campaign_id = any(v_ids);
  delete from change_requests     where campaign_id = any(v_ids);
  delete from qc_checklists       where campaign_id = any(v_ids);
  delete from crm_decisions       where campaign_id = any(v_ids);
  delete from content_change_sets where campaign_id = any(v_ids);
  delete from content_submissions where campaign_id = any(v_ids);
  delete from campaigns           where id = any(v_ids);
  get diagnostics v_removed = row_count;

  perform set_config('app.system_write', '', true);

  insert into day_delete_audit (
    launch_date, performed_by, performed_name, campaigns_removed,
    children_removed, backup_sha256, backup_name)
  values (p_day, auth.uid(), btrim(p_by_name), v_removed,
          v_children, p_backup_sha, p_backup_name);

  return v_removed;
end $$;

revoke all on function public.delete_finished_day(date, text, text, text) from public;
grant execute on function public.delete_finished_day(date, text, text, text) to authenticated;


RUN 5 OF 7 — VERIFY.

select
  (select count(*) from campaigns)        as campaigns_after,
  (select count(*) from notifications)    as notifications_after,
  (select count(*) from upload_batches)   as upload_batches_after,
  (select count(*) from day_delete_audit) as audit_rows,
  (select count(*) from public.check_trigger_enum_literals()) as bad_enum_literals;

select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('day_delete_status','day_delete_blockers',
                  'day_delete_signature','delete_finished_day')
order by proname;

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'notifications'
  and indexname = 'notifications_campaign_idx';

select * from public.check_trigger_enum_literals();


RUN 6 OF 7 — IMPERSONATION TEST, ALL FOUR ROLES. Ends in ROLLBACK.

select count(*) as campaigns_before from campaigns;
select count(*) as audit_before from day_delete_audit;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, qc_status, calendar_status)
  values ('TEST_day_a', 'CRM_PLANNED', date '2099-01-01', false,
          'LOCKED', 'READY', 'SUBMITTED', 'PASSED', 'UPDATED'),
         ('TEST_day_b', 'CRM_PLANNED', date '2099-01-02', false,
          'LOCKED', 'READY', 'SUBMITTED', 'PASSED', 'UPDATED'),
         ('TEST_day_c', 'CRM_PLANNED', date '2099-01-02', false,
          'LOCKED', 'SENT_TO_CONTENT', 'SUBMITTED', 'PENDING', 'NOT_UPDATED');

  select 'eligible day' as check, * from public.day_delete_status(date '2099-01-01');
  select 'blocked day' as check, * from public.day_delete_status(date '2099-01-02');
  select 'blockers' as check, campaign_name from public.day_delete_blockers(date '2099-01-02');
rollback;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, qc_status, calendar_status)
  values ('TEST_day_d', 'CRM_PLANNED', date '2099-01-03', false,
          'LOCKED', 'READY', 'SUBMITTED', 'PASSED', 'UPDATED');

  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'CATEGORY' limit 1) || '"}', true);
  set local role authenticated;
  select public.delete_finished_day(date '2099-01-03',
    public.day_delete_signature(date '2099-01-03'), 'x.csv', 'Hacker');
rollback;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, qc_status, calendar_status)
  values ('TEST_day_e', 'CRM_PLANNED', date '2099-01-04', false,
          'LOCKED', 'READY', 'SUBMITTED', 'PASSED', 'UPDATED');

  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'CONTENT' limit 1) || '"}', true);
  set local role authenticated;
  select public.delete_finished_day(date '2099-01-04',
    public.day_delete_signature(date '2099-01-04'), 'x.csv', 'Hacker');
rollback;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, qc_status, calendar_status)
  values ('TEST_day_f', 'CRM_PLANNED', date '2099-01-05', false,
          'LOCKED', 'READY', 'SUBMITTED', 'PASSED', 'UPDATED');

  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'EXECUTIVE' limit 1) || '"}', true);
  set local role authenticated;
  select public.delete_finished_day(date '2099-01-05',
    public.day_delete_signature(date '2099-01-05'), 'x.csv', 'Hacker');
rollback;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, qc_status, calendar_status)
  values ('TEST_day_g', 'CRM_PLANNED', date '2099-01-06', false,
          'LOCKED', 'SENT_TO_CONTENT', 'SUBMITTED', 'PENDING', 'NOT_UPDATED');

  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'CRM' limit 1) || '"}', true);
  set local role authenticated;
  select public.delete_finished_day(date '2099-01-06',
    public.day_delete_signature(date '2099-01-06'), 'x.csv', 'Test CRM User');
rollback;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, qc_status, calendar_status)
  values ('TEST_day_h', 'CRM_PLANNED', date '2099-01-07', false,
          'LOCKED', 'READY', 'SUBMITTED', 'PASSED', 'UPDATED');

  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'CRM' limit 1) || '"}', true);
  set local role authenticated;
  select public.delete_finished_day(date '2099-01-07', 'wrong-hash', 'x.csv', 'Test CRM User');
rollback;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, qc_status, calendar_status)
  values ('TEST_day_i', 'CRM_PLANNED', date '2099-01-08', false,
          'LOCKED', 'READY', 'SUBMITTED', 'PASSED', 'UPDATED');

  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'CRM' limit 1) || '"}', true);
  set local role authenticated;
  select 'CRM deletes an eligible day' as check,
         public.delete_finished_day(date '2099-01-08',
           public.day_delete_signature(date '2099-01-08'),
           'backup.csv', 'Test CRM User') as removed;
  reset role;
  select 'audit written' as check, count(*) as rows from day_delete_audit;
rollback;

select count(*) as campaigns_after from campaigns;
select count(*) as audit_after from day_delete_audit;
select count(*) as test_rows_left from campaigns where campaign_name like 'TEST\_%';


RUN 7 OF 7 — ROLLBACK NOTE. Run only to undo.

drop function if exists public.delete_finished_day(date, text, text, text);
drop function if exists public.day_delete_signature(date);
drop function if exists public.day_delete_blockers(date);
drop function if exists public.day_delete_status(date);
drop policy if exists day_delete_audit_read on day_delete_audit;
drop table if exists day_delete_audit;
drop index if exists notifications_campaign_idx;
