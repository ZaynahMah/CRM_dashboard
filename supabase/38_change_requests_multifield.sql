RUN 1 OF 6 — READ-ONLY CHECKS. Paste and run alone. Changes nothing.

select
  (select count(*) from campaigns)                      as campaigns_before,
  (select count(*) from notifications)                  as notifications_before,
  (select count(*) from change_requests)                as change_requests_before,
  (select count(*) from change_requests where status = 'PENDING') as pending_before;

select policyname, cmd, qual::text as using_expr, with_check::text as check_expr
from pg_policies
where schemaname = 'public' and tablename in ('change_requests','campaigns')
order by tablename, cmd, policyname;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'change_requests'
order by ordinal_position;

select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
where t.typname = 'change_status' order by e.enumsortorder;

select count(*) as bad_enum_literals from public.check_trigger_enum_literals();


RUN 2 OF 6 — MULTI-FIELD AND CONTENT-RAISED REQUESTS. Safe, additive.

alter table change_requests add column if not exists request_group_id uuid;
alter table change_requests add column if not exists requested_by_name text;
alter table change_requests add column if not exists requested_by_role app_role;
alter table change_requests add column if not exists reviewed_by_name text;
alter table change_requests add column if not exists review_note text;
alter table change_requests add column if not exists withdrawn_at timestamptz;

create index if not exists change_requests_group_idx
  on change_requests (request_group_id) where request_group_id is not null;
create index if not exists change_requests_open_idx
  on change_requests (campaign_id, status) where status = 'PENDING';

do $$ begin
  alter type change_status add value if not exists 'WITHDRAWN';
exception when others then null; end $$;


RUN 3 OF 6 — RAISE A MULTI-FIELD REQUEST. Run after run 2 has committed.

create or replace function public.raise_change_request(
  p_campaign_id uuid,
  p_fields jsonb,
  p_by_name text,
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := public.current_app_role();
  v_group uuid := gen_random_uuid();
  v_c campaigns;
  v_field text;
  v_new text;
  v_allowed text[];
  v_count int := 0;
begin
  if v_role is null or v_role not in ('CATEGORY'::app_role, 'CONTENT'::app_role) then
    raise exception 'Only Category or Content can raise a change request here.';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Your name is required on a change request.';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object'
     or (select count(*) from jsonb_object_keys(p_fields)) = 0 then
    raise exception 'No changes were supplied.';
  end if;

  select * into v_c from campaigns where id = p_campaign_id;
  if not found then raise exception 'That PN no longer exists.'; end if;

  if v_c.calendar_status = 'UPDATED' then
    raise exception 'This PN is on the calendar. Ask CRM to remove it from the calendar first.';
  end if;

  if v_role = 'CATEGORY'::app_role then
    if v_c.category_submitted_at is null then
      raise exception 'Category input has not been submitted yet, so it can still be edited directly.';
    end if;
    v_allowed := array['sub_category','brand','offer','brief','landing',
                       'expected_cvr','expected_rpv','additional_notes','date_time_brief'];
  else
    if v_c.content_submitted_at is null then
      raise exception 'Copy has not been submitted yet, so it can still be edited directly.';
    end if;
    v_allowed := array['header','sub_copy_text','reference_link'];
  end if;

  if exists (select 1 from change_requests
             where campaign_id = p_campaign_id and status = 'PENDING'
               and requested_by_role = v_role) then
    raise exception 'A change request for this PN is already waiting for CRM.';
  end if;

  for v_field, v_new in select key, value #>> '{}' from jsonb_each(p_fields) loop
    if not (v_field = any(v_allowed)) then
      raise exception 'Your team may not request a change to %.', v_field;
    end if;

    if v_role = 'CATEGORY'::app_role
       and v_field = any(array['sub_category','brand','offer','brief','landing',
                               'expected_cvr','expected_rpv'])
       and coalesce(btrim(v_new), '') = '' then
      raise exception 'A change request may not blank %.', v_field;
    end if;

    if v_field = 'header' and length(coalesce(v_new,'')) > 60 then
      raise exception 'Header is % characters, over the 60 limit.', length(v_new);
    end if;
    if v_field = 'sub_copy_text' and length(coalesce(v_new,'')) > 200 then
      raise exception 'Sub Copy is % characters, over the 200 limit.', length(v_new);
    end if;

    execute format(
      'insert into change_requests (campaign_id, requested_by, field_name,
         current_value, requested_value, reason, status, request_group_id,
         requested_by_name, requested_by_role)
       select $1, $2, $3, ($4::campaigns).%I::text, $5, $6,
         ''PENDING''::change_status, $7, $8, $9', v_field)
      using p_campaign_id, auth.uid(), v_field, v_c, v_new,
            nullif(btrim(coalesce(p_reason,'')),''), v_group,
            btrim(p_by_name), v_role;
    v_count := v_count + 1;
  end loop;

  begin
    insert into activity_logs (campaign_id, user_id, action, description)
    values (p_campaign_id, auth.uid(), 'CHANGE_REQUEST_RAISED',
      format('%s (%s) requested %s change(s): %s', v_role::text, btrim(p_by_name),
        v_count, (select string_agg(key, ', ') from jsonb_object_keys(p_fields) key)));
  exception when others then
    raise warning 'Change request saved but not logged: %', sqlerrm;
  end;

  return v_group;
end $$;

revoke all on function public.raise_change_request(uuid, jsonb, text, text) from public;
grant execute on function public.raise_change_request(uuid, jsonb, text, text) to authenticated;


RUN 4 OF 6 — ACCEPT, REJECT, WITHDRAW.

create or replace function public.decide_change_group(
  p_group_id uuid,
  p_accept boolean,
  p_by_name text,
  p_note text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_campaign uuid;
  v_applied int := 0;
  v_copy_affecting boolean := false;
  v_role app_role;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can accept or reject a change request.';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Your name is required.';
  end if;

  select campaign_id, requested_by_role into v_campaign, v_role
  from change_requests where request_group_id = p_group_id limit 1;
  if v_campaign is null then raise exception 'Change request not found.'; end if;

  perform 1 from campaigns where id = v_campaign for update;

  if not p_accept then
    update change_requests
       set status = 'REJECTED'::change_status, reviewed_by = auth.uid(),
           reviewed_at = now(), reviewed_by_name = btrim(p_by_name),
           review_note = nullif(btrim(coalesce(p_note,'')),'')
     where request_group_id = p_group_id and status = 'PENDING';

    begin
      insert into activity_logs (campaign_id, user_id, action, description)
      values (v_campaign, auth.uid(), 'CHANGE_REQUEST_REJECTED',
        format('CRM (%s) rejected the %s change request.%s', btrim(p_by_name),
          v_role::text,
          case when coalesce(btrim(p_note,''),'') = '' then ''
               else ' Reason: ' || btrim(p_note) end));
    exception when others then
      raise warning 'Rejection saved but not logged: %', sqlerrm;
    end;
    return 0;
  end if;

  perform public.begin_system_write();

  for r in select * from change_requests
           where request_group_id = p_group_id and status = 'PENDING' loop
    execute format('update campaigns set %I = $1 where id = $2', r.field_name)
      using r.requested_value, r.campaign_id;
    v_applied := v_applied + 1;
    if r.field_name = any(array['brand','offer','landing','header','sub_copy_text']) then
      v_copy_affecting := true;
    end if;
  end loop;

  update change_requests
     set status = 'APPROVED'::change_status, reviewed_by = auth.uid(),
         reviewed_at = now(), reviewed_by_name = btrim(p_by_name),
         review_note = nullif(btrim(coalesce(p_note,'')),'')
   where request_group_id = p_group_id and status = 'PENDING';

  if v_copy_affecting or exists (
       select 1 from campaigns c where c.id = v_campaign and c.qc_status = 'PASSED'::qc_status) then
    update campaigns
       set qc_status = 'PENDING'::qc_status,
           crm_status = case when v_role = 'CATEGORY'::app_role
                             then 'AWAITING_REVIEW'::crm_status
                             else 'SENT_TO_CONTENT'::crm_status end
     where id = v_campaign;
    update qc_checklists set copy_verified = false
     where campaign_id = v_campaign and copy_verified;
  end if;

  perform set_config('app.system_write', '', true);

  begin
    insert into activity_logs (campaign_id, user_id, action, description)
    values (v_campaign, auth.uid(), 'CHANGE_REQUEST_ACCEPTED',
      format('CRM (%s) accepted %s change(s) from %s.', btrim(p_by_name),
             v_applied, v_role::text));
  exception when others then
    raise warning 'Acceptance saved but not logged: %', sqlerrm;
  end;

  return v_applied;
end $$;

revoke all on function public.decide_change_group(uuid, boolean, text, text) from public;
grant execute on function public.decide_change_group(uuid, boolean, text, text) to authenticated;

create or replace function public.withdraw_change_group(
  p_group_id uuid, p_by_name text
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_role app_role := public.current_app_role(); v_campaign uuid; v_n int;
begin
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Your name is required.';
  end if;
  select campaign_id into v_campaign from change_requests
   where request_group_id = p_group_id and requested_by_role = v_role limit 1;
  if v_campaign is null then
    raise exception 'That change request is not yours to withdraw.';
  end if;

  update change_requests
     set status = 'WITHDRAWN'::change_status, withdrawn_at = now()
   where request_group_id = p_group_id and status = 'PENDING';
  get diagnostics v_n = row_count;

  begin
    insert into activity_logs (campaign_id, user_id, action, description)
    values (v_campaign, auth.uid(), 'CHANGE_REQUEST_WITHDRAWN',
      format('%s (%s) withdrew their change request.', v_role::text, btrim(p_by_name)));
  exception when others then
    raise warning 'Withdrawal saved but not logged: %', sqlerrm;
  end;

  return v_n;
end $$;

revoke all on function public.withdraw_change_group(uuid, text) from public;
grant execute on function public.withdraw_change_group(uuid, text) to authenticated;

drop policy if exists cr_update on change_requests;
create policy cr_update on change_requests for update to authenticated
  using (public.is_crm() or requested_by = auth.uid())
  with check (public.is_crm() or requested_by = auth.uid());


RUN 5 OF 6 — VERIFY.

select
  (select count(*) from campaigns)       as campaigns_after,
  (select count(*) from notifications)   as notifications_after,
  (select count(*) from change_requests) as change_requests_after,
  (select count(*) from public.check_trigger_enum_literals()) as bad_enum_literals;

select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('raise_change_request','decide_change_group','withdraw_change_group')
order by proname;

select * from public.check_trigger_enum_literals();


RUN 6 OF 6 — IMPERSONATION TEST. Ends in ROLLBACK and keeps nothing.

select count(*) as campaigns_before from campaigns;
select count(*) as change_requests_before from change_requests;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, crm_status, content_status, category_submitted_at,
    content_submitted_at, sub_category, brand, offer, brief, landing,
    expected_cvr, expected_rpv, header, qc_status, calendar_status)
  values ('TEST_cr', 'CRM_PLANNED', current_date + 60, false,
    'LOCKED', 'SENT_TO_CONTENT', 'SUBMITTED', now(), now(),
    'Shoes', 'Biba', '40 off', 'Festive', 'https://www.tatacliq.com/x',
    '2', '50', 'Old header', 'PASSED', 'NOT_UPDATED');

  set local role authenticated;
  select set_config('request.jwt.claims',
  '{"sub":"' || (select id from profiles where role = 'CONTENT' limit 1) || '"}',
  true);
  select public.raise_change_request(
    (select id from campaigns where campaign_name = 'TEST_cr'),
    '{"header":"New header","sub_copy_text":"New sub copy"}'::jsonb,
    'Test Content User', 'typo fix') as group_id;
  reset role;

  select count(*) as rows_in_group, min(status::text) as status
  from change_requests where requested_by_name = 'Test Content User';

  set local role authenticated;
  select set_config('request.jwt.claims',
  '{"sub":"' || (select id from profiles where role = 'CRM' limit 1) || '"}',
  true);
  select public.decide_change_group(
    (select request_group_id from change_requests
      where requested_by_name = 'Test Content User' limit 1),
    true, 'Test CRM User') as applied;
  reset role;

  select header, qc_status::text, crm_status::text
  from campaigns where campaign_name = 'TEST_cr';
rollback;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims',
  '{"sub":"' || (select id from profiles where role = 'CATEGORY' limit 1) || '"}',
  true);
  select public.raise_change_request(
    (select id from campaigns limit 1),
    '{"header":"hack"}'::jsonb, 'Test Category User');
rollback;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims',
  '{"sub":"' || (select id from profiles where role = 'EXECUTIVE' limit 1) || '"}',
  true);
  select public.raise_change_request(
    (select id from campaigns limit 1),
    '{"brand":"x"}'::jsonb, 'Test Exec User');
rollback;

select count(*) as campaigns_after from campaigns;
select count(*) as change_requests_after from change_requests;
select count(*) as test_rows_left from campaigns where campaign_name like 'TEST\_%';
