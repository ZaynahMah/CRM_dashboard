RUN 1 OF 4 — READ-ONLY CHECKS

select
  (select count(*) from campaigns) as campaigns_before,
  (select count(*) from change_requests) as change_requests_before,
  (select count(*) from change_requests where status = 'PENDING') as pending_before;

select policyname, cmd, qual::text as using_expr
from pg_policies where schemaname = 'public' and tablename = 'change_requests'
order by cmd, policyname;

select count(*) as category_requests_after_handoff
from change_requests r join campaigns c on c.id = r.campaign_id
where r.status = 'PENDING' and r.requested_by_role = 'CATEGORY'
  and c.content_status is distinct from 'NOT_ASSIGNED';

select count(*) as bad_enum_literals from public.check_trigger_enum_literals();


RUN 2 OF 4 — CATEGORY CUT-OFF IN raise_change_request

create or replace function public.raise_change_request(
  p_campaign_id uuid, p_fields jsonb, p_by_name text, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := public.current_app_role();
  v_group uuid := gen_random_uuid();
  v_c campaigns; v_field text; v_new text; v_allowed text[]; v_count int := 0;
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
    if v_c.content_status is distinct from 'NOT_ASSIGNED'::content_status then
      raise exception 'This PN has already been sent to Content. Ask CRM.';
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


RUN 3 OF 4 — EACH TEAM READS ONLY ITS OWN REQUESTS

drop policy if exists cr_read on change_requests;
create policy cr_read on change_requests for select to authenticated
using (
  public.is_crm() is true
  or public.current_app_role() = 'EXECUTIVE'::app_role
  or requested_by_role = public.current_app_role()
  or requested_by = auth.uid()
);


RUN 4 OF 4 — VERIFY

select
  (select count(*) from campaigns) as campaigns_after,
  (select count(*) from change_requests) as change_requests_after,
  (select count(*) from public.check_trigger_enum_literals()) as bad_enum_literals;

select policyname, cmd, qual::text as using_expr
from pg_policies where schemaname = 'public' and tablename = 'change_requests'
order by cmd, policyname;

select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname = 'raise_change_request';
