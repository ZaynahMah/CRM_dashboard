RUN 1 OF 4 — READ-ONLY CHECKS. Paste and run alone. Changes nothing.

select
  (select count(*) from campaigns)     as campaigns_before,
  (select count(*) from notifications) as notifications_before;

select proname, prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('day_delete_status','day_delete_blockers','day_delete_signature')
order by proname;

select count(*) as bad_enum_literals from public.check_trigger_enum_literals();


RUN 2 OF 4 — CRM-ONLY ON THE THREE READ FUNCTIONS.

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
) language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_crm() is not true then
    raise exception 'Only CRM can view day deletion status.';
  end if;
  return query
  select
    p_day,
    count(*)::int,
    count(*) filter (where c.calendar_status = 'UPDATED')::int,
    count(*) filter (where c.calendar_status is distinct from 'UPDATED')::int,
    count(*) filter (where c.calendar_status is distinct from 'UPDATED'
                       and c.category_status in ('EMPTY','DRAFT'))::int,
    count(*) filter (where c.calendar_status is distinct from 'UPDATED'
                       and c.content_status in ('PENDING','NEEDS_CHANGES'))::int,
    count(*) filter (where c.calendar_status is distinct from 'UPDATED'
                       and c.content_status = 'SUBMITTED')::int,
    count(*) > 0 and count(*) filter (where c.calendar_status is distinct from 'UPDATED') = 0
  from campaigns c
  where c.launch_date = p_day;
end $$;
grant execute on function public.day_delete_status(date) to authenticated;

create or replace function public.day_delete_blockers(p_day date)
returns table (id uuid, campaign_name text, slot_label text,
               category_status text, content_status text, qc_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_crm() is not true then
    raise exception 'Only CRM can view day deletion blockers.';
  end if;
  return query
  select c.id, c.campaign_name, c.slot_label,
         c.category_status::text, c.content_status::text, c.qc_status::text
  from campaigns c
  where c.launch_date = p_day
    and c.calendar_status is distinct from 'UPDATED'
  order by c.slot_number nulls last, c.campaign_name;
end $$;
grant execute on function public.day_delete_blockers(date) to authenticated;

create or replace function public.day_delete_signature(p_day date)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_sig text;
begin
  if public.is_crm() is not true then
    raise exception 'Only CRM can compute a day signature.';
  end if;
  select coalesce(
    encode(sha256(convert_to(
      coalesce(string_agg(c.id::text || ':' || coalesce(c.updated_at::text,''),
                          '|' order by c.id), ''), 'UTF8')), 'hex'), '')
  into v_sig
  from campaigns c where c.launch_date = p_day;
  return v_sig;
end $$;
grant execute on function public.day_delete_signature(date) to authenticated;


RUN 3 OF 4 — VERIFY.

select
  (select count(*) from campaigns)     as campaigns_after,
  (select count(*) from notifications) as notifications_after,
  (select count(*) from public.check_trigger_enum_literals()) as bad_enum_literals;

select public.day_delete_signature(date '2099-12-31') as empty_day_signature;

select * from public.check_trigger_enum_literals();


RUN 4 OF 4 — IMPERSONATION TEST. Ends in ROLLBACK.

select count(*) as campaigns_before from campaigns;

begin;
  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'CATEGORY' limit 1) || '"}', true);
  set local role authenticated;
  select public.day_delete_status(current_date);
rollback;

begin;
  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'CONTENT' limit 1) || '"}', true);
  set local role authenticated;
  select public.day_delete_blockers(current_date);
rollback;

begin;
  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'EXECUTIVE' limit 1) || '"}', true);
  set local role authenticated;
  select public.day_delete_signature(current_date);
rollback;

begin;
  select set_config('request.jwt.claims',
    '{"sub":"' || (select id from profiles where role = 'CRM' limit 1) || '"}', true);
  set local role authenticated;
  select 'CRM can read status' as check, eligible from public.day_delete_status(current_date);
rollback;

select count(*) as campaigns_after from campaigns;


ROLLBACK NOTE. Re-run runs 3 and 4 of migration 40 to restore the open versions.
