RUN 1 OF 4 — READ-ONLY CHECKS

select
  (select count(*) from campaigns) as campaigns_before,
  (select count(*) from day_delete_audit) as audit_before,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='day_delete_audit'
      and column_name in ('performed_by_tataunistore_id','forced')) as new_columns_present;

select launch_date, count(*) as total_pns,
       count(*) filter (where calendar_status = 'UPDATED') as on_calendar,
       count(*) filter (where calendar_status is distinct from 'UPDATED') as not_on_calendar
from campaigns group by launch_date order by launch_date;

select count(*) as bad_enum_literals from public.check_trigger_enum_literals();


RUN 2 OF 4 — TWO NULLABLE COLUMNS

alter table day_delete_audit add column if not exists performed_by_tataunistore_id text;
alter table day_delete_audit add column if not exists forced boolean not null default false;


RUN 3 OF 4 — THE FORCE DELETE FUNCTION

create or replace function public.force_delete_day(
  p_day date,
  p_backup_sha text,
  p_backup_name text,
  p_by_name text,
  p_tataunistore_id text
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
  if coalesce(btrim(p_tataunistore_id), '') = '' then
    raise exception 'Your TataUnistore ID is required.';
  end if;
  if lower(btrim(p_tataunistore_id)) !~ '^[a-z0-9._%+-]+@tataunistore\.com$' then
    raise exception 'The TataUnistore ID must be an @tataunistore.com email address.';
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
    children_removed, backup_sha256, backup_name,
    performed_by_tataunistore_id, forced)
  values (p_day, auth.uid(), btrim(p_by_name), v_removed,
          v_children, p_backup_sha, p_backup_name,
          lower(btrim(p_tataunistore_id)), true);

  return v_removed;
end $$;

revoke all on function public.force_delete_day(date, text, text, text, text) from public;
grant execute on function public.force_delete_day(date, text, text, text, text) to authenticated;


RUN 4 OF 4 — VERIFY

select
  (select count(*) from campaigns) as campaigns_after,
  (select count(*) from day_delete_audit) as audit_after,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='day_delete_audit'
      and column_name in ('performed_by_tataunistore_id','forced')) as new_columns_present,
  (select count(*) from public.check_trigger_enum_literals()) as bad_enum_literals;

select proname, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in ('delete_finished_day','force_delete_day')
order by proname;
