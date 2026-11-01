RUN 1 OF 5 — READ-ONLY CHECKS. Paste and run alone. Changes nothing.

select
  (select count(*) from campaigns)                                   as campaigns_before,
  (select count(*) from notifications)                               as notifications_before,
  (select count(*) from campaigns where calendar_status = 'UPDATED') as on_calendar_before;

select policyname, cmd, qual::text as using_expr, with_check::text as check_expr
from pg_policies
where schemaname = 'public' and tablename = 'campaigns' and cmd = 'UPDATE';

select pg_get_functiondef(p.oid) as enforce_calendar_lock_now
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'enforce_calendar_lock';

select count(*) as bad_enum_literals from public.check_trigger_enum_literals();


RUN 2 OF 5 — LOCK CRM OUT OF A CALENDAR PN.

drop policy if exists campaigns_update on campaigns;
create policy campaigns_update on campaigns
  for update to authenticated
  using (
    (public.is_crm() and calendar_status is distinct from 'UPDATED')
    or (public.current_app_role() = 'CATEGORY'::app_role
        and category_status in ('EMPTY','DRAFT','LOCKED','SUBMITTED')
        and calendar_status is distinct from 'UPDATED')
    or (public.current_app_role() = 'CONTENT'::app_role
        and content_status in ('NOT_ASSIGNED','PENDING','NEEDS_CHANGES','SUBMITTED')
        and calendar_status is distinct from 'UPDATED')
  )
  with check (
    public.is_crm()
    or (public.current_app_role() = 'CATEGORY'::app_role
        and category_status in ('EMPTY','DRAFT','LOCKED','SUBMITTED')
        and calendar_status is distinct from 'UPDATED')
    or (public.current_app_role() = 'CONTENT'::app_role
        and content_status in ('NOT_ASSIGNED','PENDING','NEEDS_CHANGES','SUBMITTED')
        and calendar_status is distinct from 'UPDATED')
  );


RUN 3 OF 5 — THE TRIGGER STOPS EXEMPTING CRM.

create or replace function public.enforce_calendar_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role app_role := public.current_app_role();
begin
  if coalesce(current_setting('app.system_write', true), '') = 'on' then
    return new;
  end if;
  if v_role is null then
    return new;
  end if;
  if old.calendar_status = 'UPDATED' and new.calendar_status = 'UPDATED' then
    raise exception
      'This PN is on the calendar and is locked. Use Remove from calendar first.';
  end if;
  return new;
end $$;


RUN 4 OF 5 — VERIFY.

select
  (select count(*) from campaigns)                                  as campaigns_after,
  (select count(*) from notifications)                              as notifications_after,
  (select count(*) from campaigns where calendar_status = 'UPDATED') as on_calendar_after,
  (select count(*) from public.check_trigger_enum_literals())        as bad_enum_literals;

select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'campaigns' and cmd = 'UPDATE';

select * from public.check_trigger_enum_literals();


RUN 5 OF 5 — IMPERSONATION TEST AS THE REAL CRM ROLE. Ends in ROLLBACK.

select count(*) as campaigns_before from campaigns;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, header, brand,
    qc_status, calendar_status)
  values ('TEST_lock39', 'CRM_PLANNED', current_date + 60, false,
    'LOCKED', 'READY', 'SUBMITTED', 'Old header', 'Biba', 'PASSED', 'UPDATED');

  set local role authenticated;
  select set_config('request.jwt.claims',
  '{"sub":"' || (select id from profiles where role = 'CRM' limit 1) || '"}',
  true);
  update campaigns set brand = 'Hacked' where campaign_name = 'TEST_lock39';
  reset role;

  select 'A brand unchanged' as check, brand as value
  from campaigns where campaign_name = 'TEST_lock39';
rollback;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, header, brand,
    qc_status, calendar_status)
  values ('TEST_lock39b', 'CRM_PLANNED', current_date + 60, false,
    'LOCKED', 'READY', 'SUBMITTED', 'Old header', 'Biba', 'PASSED', 'UPDATED');

  set local role authenticated;
  select set_config('request.jwt.claims',
  '{"sub":"' || (select id from profiles where role = 'CRM' limit 1) || '"}',
  true);
  select public.remove_from_calendar(
    (select id from campaigns where campaign_name = 'TEST_lock39b'),
    'Test CRM User', 'reopening for a fix');

  update campaigns set brand = 'Allowed now' where campaign_name = 'TEST_lock39b';
  reset role;

  select 'B reopened and edited' as check, brand as value,
         calendar_status as cal, qc_status::text as qc
  from campaigns where campaign_name = 'TEST_lock39b';
rollback;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, header, brand,
    qc_status, calendar_status)
  values ('TEST_lock39c', 'CRM_PLANNED', current_date + 60, false,
    'LOCKED', 'READY', 'SUBMITTED', 'H', 'Biba', 'PASSED', 'NOT_UPDATED');

  set local role authenticated;
  select set_config('request.jwt.claims',
  '{"sub":"' || (select id from profiles where role = 'CRM' limit 1) || '"}',
  true);
  update campaigns set calendar_status = 'UPDATED' where campaign_name = 'TEST_lock39c';
  reset role;

  select 'C push to calendar still works' as check, calendar_status as value
  from campaigns where campaign_name = 'TEST_lock39c';
rollback;

select count(*) as campaigns_after from campaigns;
select count(*) as test_rows_left from campaigns where campaign_name like 'TEST\_%';


ROLLBACK NOTE

drop policy if exists campaigns_update on campaigns;
create policy campaigns_update on campaigns
  for update to authenticated
  using (
    public.is_crm()
    or (public.current_app_role() = 'CATEGORY'::app_role
        and category_status in ('EMPTY','DRAFT','LOCKED','SUBMITTED')
        and calendar_status is distinct from 'UPDATED')
    or (public.current_app_role() = 'CONTENT'::app_role
        and content_status in ('NOT_ASSIGNED','PENDING','NEEDS_CHANGES','SUBMITTED')
        and calendar_status is distinct from 'UPDATED')
  )
  with check (
    public.is_crm()
    or (public.current_app_role() = 'CATEGORY'::app_role
        and category_status in ('EMPTY','DRAFT','LOCKED','SUBMITTED')
        and calendar_status is distinct from 'UPDATED')
    or (public.current_app_role() = 'CONTENT'::app_role
        and content_status in ('NOT_ASSIGNED','PENDING','NEEDS_CHANGES','SUBMITTED')
        and calendar_status is distinct from 'UPDATED')
  );

create or replace function public.enforce_calendar_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role app_role := public.current_app_role();
begin
  if coalesce(current_setting('app.system_write', true), '') = 'on' then
    return new;
  end if;
  if v_role is null or v_role = 'CRM'::app_role then
    return new;
  end if;
  if old.calendar_status = 'UPDATED' then
    raise exception
      'This PN is on the calendar and is locked. Ask CRM to remove it from the calendar first.';
  end if;
  return new;
end $$;
