-- =====================================================================
-- CLiQ Push Ops — 29: reset RUNNING PNs only
--
-- Run TWENTY-NINTH, after 28. Idempotent; safe to rerun.
--
-- TWO CHANGES, both the same safety fix.
--
-- 1. NEW `reset_running_pns(p_is_crm_self)` — the red Reset button. Archives
--    then deletes, the same pattern as the upload reset, but limited to
--    RUNNING PNs. One transaction: either all of it or none.
--
-- 2. FIXES `reset_campaigns_with_archive` (migration 25). It deleted EVERY
--    PN in the stream on every CRM upload, including ones already pushed to
--    the calendar or past Final QC. The same running filter now applies, so
--    an upload replaces running PNs and never removes live work.
--
-- "RUNNING" uses IS DISTINCT FROM, not <>, so a NULL status is INCLUDED.
-- With `<>`, a row whose calendar_status is NULL would evaluate to NULL,
-- fail the predicate, and be silently skipped — left behind by a reset that
-- claimed to clear everything.
-- =====================================================================

-- ═════════ COUNT FIRST — run this before anything else ═════════
-- What a reset WOULD touch, per flow. Read-only.
select
  case when is_crm_self then 'CRM Self' else 'Category-led' end as flow,
  count(*) filter (
    where calendar_status   is distinct from 'UPDATED'
      and qc_status         is distinct from 'PASSED'
      and production_status is distinct from 'READY')            as would_reset,
  count(*) filter (
    where calendar_status   is not distinct from 'UPDATED'
       or qc_status         is not distinct from 'PASSED'
       or production_status is not distinct from 'READY')        as would_keep,
  count(*)                                                       as total
from campaigns
group by 1
order by 1;

-- The kept rows in detail, so you can confirm nothing live is at risk.
select
  case when is_crm_self then 'CRM Self' else 'Category-led' end as flow,
  count(*) filter (where calendar_status   is not distinct from 'UPDATED') as on_calendar,
  count(*) filter (where qc_status         is not distinct from 'PASSED')  as qc_passed,
  count(*) filter (where production_status is not distinct from 'READY')   as production_ready
from campaigns
group by 1 order by 1;

-- ═════════ 1. THE RUNNING PREDICATE, IN ONE PLACE ═════════
create or replace function public.is_running_pn(
  p_calendar text, p_qc text, p_production text
) returns boolean language sql immutable set search_path = public as $$
  select p_calendar   is distinct from 'UPDATED'
     and p_qc         is distinct from 'PASSED'
     and p_production is distinct from 'READY'
$$;

-- ═════════ 2. RESET RUNNING PNs ═════════
create or replace function public.reset_running_pns(p_is_crm_self boolean)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_batch  uuid := gen_random_uuid();
  v_actor  uuid := auth.uid();
  v_count  integer := 0;
  v_live   integer := 0;
  v_cols   text;
  v_flow   text := case when p_is_crm_self then 'CRM Self' else 'Category-led' end;
begin
  -- CRM only. First statement, before SECURITY DEFINER rights reach
  -- anything destructive; the API route checks the role as well.
  if not public.is_crm() then
    raise exception 'Only CRM can reset running campaigns.';
  end if;

  set local lock_timeout = '15s';

  select count(*) into v_live
    from campaigns
   where is_crm_self = p_is_crm_self
     and public.is_running_pn(calendar_status::text, qc_status::text, production_status::text);

  if v_live = 0 then
    return 0;   -- Nothing running. The button is disabled for this too.
  end if;

  -- ---------- archive, matching columns BY NAME ----------
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='campaigns'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='campaigns_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into campaigns_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from campaigns
      where is_crm_self = $3
        and public.is_running_pn(calendar_status::text, qc_status::text, production_status::text)',
    v_cols, v_cols)
    using v_batch, v_actor, p_is_crm_self;
  get diagnostics v_count = row_count;

  -- Verify the archive BEFORE deleting anything.
  if v_count <> v_live then
    raise exception 'Archive incomplete: % of % running % PNs archived. Aborting.',
      v_count, v_live, v_flow;
  end if;

  -- ---------- delete, children first, RUNNING ONLY ----------
  -- Every statement carries a real predicate, so pg_safeupdate is satisfied
  -- and a live PN can never be caught by a missing WHERE.
  delete from change_requests cr using campaigns c
   where c.id = cr.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from notifications n using campaigns c
   where c.id = n.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from activity_logs l using campaigns c
   where c.id = l.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from qc_checklists q using campaigns c
   where c.id = q.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from crm_decisions d using campaigns c
   where c.id = d.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from content_submissions s using campaigns c
   where c.id = s.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);

  delete from campaigns
   where is_crm_self = p_is_crm_self
     and public.is_running_pn(calendar_status::text, qc_status::text, production_status::text);

  insert into upload_reset_batches (
    id, performed_by, is_crm_self, campaigns_archived, campaigns_inserted)
  values (v_batch, v_actor, p_is_crm_self, v_count, 0);

  -- Activities: who reset, when, which flow, how many.
  insert into activities (event_type, category, details, actor_id, dedupe_key)
  values ('RESET_RUNNING', null,
    format('CRM reset %s running %s PN(s). Archived as batch %s. Calendar, QC-passed and '
           || 'production-ready PNs were not touched.', v_count, v_flow, v_batch),
    v_actor, 'RESET_RUNNING:' || v_batch);

  insert into activity_logs (campaign_id, user_id, action, description)
  values (null, v_actor, 'RESET_RUNNING_PNS',
    format('Reset %s running %s PN(s). Archive batch %s.', v_count, v_flow, v_batch));

  return v_count;
end $$;
revoke all on function public.reset_running_pns(boolean) from public;
grant execute on function public.reset_running_pns(boolean) to authenticated;

-- ═════════ 3. PREVIEW FOR THE MODAL ═════════
-- N, shown before the user confirms. Counts only, no row data.
create or replace function public.running_pn_count(p_is_crm_self boolean)
returns integer language sql security definer set search_path = public stable as $$
  select count(*)::int from campaigns
   where is_crm_self = p_is_crm_self
     and public.is_running_pn(calendar_status::text, qc_status::text, production_status::text);
$$;
grant execute on function public.running_pn_count(boolean) to authenticated;

-- ═════════ 4. THE UPLOAD RESET GETS THE SAME FILTER ═════════
-- Previously this deleted EVERY PN in the stream, live ones included.
-- Everything else about it is unchanged: CRM-only, empty sheet refused,
-- required fields checked, archive verified before any delete, one
-- transaction, `is_crm_self` forced from the upload type.
create or replace function public.reset_campaigns_with_archive(
  p_rows jsonb, p_is_crm_self boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid := gen_random_uuid(); v_actor uuid := auth.uid();
  v_campaigns integer := 0; v_inserted integer := 0; v_live integer := 0;
  v_cols text;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can reset campaigns.';
  end if;
  set local lock_timeout = '15s';

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'reset_campaigns_with_archive expects a JSON array of rows.';
  end if;
  -- The "no rows" protection stays.
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Refusing to reset: the uploaded sheet contains no rows.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e
             where coalesce(e->>'campaign_name','') = '' or (e->>'launch_date') is null) then
    raise exception
      'Refusing to reset: every row needs a campaign_name and a launch_date. '
      'Check the Date column in the uploaded sheet.';
  end if;

  select count(*) into v_live from campaigns
   where is_crm_self = p_is_crm_self
     and public.is_running_pn(calendar_status::text, qc_status::text, production_status::text);

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='campaigns'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='campaigns_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into campaigns_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from campaigns
      where is_crm_self = $3
        and public.is_running_pn(calendar_status::text, qc_status::text, production_status::text)',
    v_cols, v_cols)
    using v_batch, v_actor, p_is_crm_self;
  get diagnostics v_campaigns = row_count;

  if v_campaigns <> v_live then
    raise exception 'Archive incomplete: % of % running PNs archived. Aborting.',
      v_campaigns, v_live;
  end if;

  -- RUNNING ONLY. Calendar, QC-passed and production-ready PNs survive.
  delete from change_requests cr using campaigns c
   where c.id = cr.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from notifications n using campaigns c
   where c.id = n.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from activity_logs l using campaigns c
   where c.id = l.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from qc_checklists q using campaigns c
   where c.id = q.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from crm_decisions d using campaigns c
   where c.id = d.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);
  delete from content_submissions s using campaigns c
   where c.id = s.campaign_id and c.is_crm_self = p_is_crm_self
     and public.is_running_pn(c.calendar_status::text, c.qc_status::text, c.production_status::text);

  delete from campaigns
   where is_crm_self = p_is_crm_self
     and public.is_running_pn(calendar_status::text, qc_status::text, production_status::text);

  insert into campaigns (
    campaign_name, campaign_origin, launch_date, launch_time, slot_number, slot_label,
    pncc_segment_label, pncc_category_code, category, slot_type, is_crm_self,
    sub_category, brand, offer, title_brief, message_brief, pn_template,
    creative_requirements, category_status, crm_status, content_status,
    qc_status, production_status, priority, created_by)
  select
    r.campaign_name, coalesce(r.campaign_origin,'CRM_PLANNED')::campaign_origin,
    r.launch_date, r.launch_time, r.slot_number, r.slot_label,
    r.pncc_segment_label, r.pncc_category_code, r.category,
    coalesce(r.slot_type,'STANDARD'), p_is_crm_self,
    r.sub_category, r.brand, r.offer, r.title_brief, r.message_brief, r.pn_template,
    r.creative_requirements,
    coalesce(r.category_status,'EMPTY')::category_status,
    coalesce(r.crm_status,'NOT_STARTED')::crm_status,
    coalesce(r.content_status,'NOT_ASSIGNED')::content_status,
    coalesce(r.qc_status,'PENDING')::qc_status,
    coalesce(r.production_status,'NOT_READY')::production_status,
    coalesce(r.priority,'NORMAL')::priority_level,
    r.created_by
  from jsonb_to_recordset(p_rows) as r(
    campaign_name text, campaign_origin text, launch_date date, launch_time time,
    slot_number integer, slot_label text, pncc_segment_label text, pncc_category_code text,
    category text, slot_type text, is_crm_self boolean,
    sub_category text, brand text, offer text, title_brief text, message_brief text,
    pn_template text, creative_requirements text,
    category_status text, crm_status text, content_status text, qc_status text,
    production_status text, priority text, created_by uuid);
  get diagnostics v_inserted = row_count;

  if v_inserted <> jsonb_array_length(p_rows) then
    raise exception 'Insert incomplete: % of % rows written. Aborting.',
      v_inserted, jsonb_array_length(p_rows);
  end if;

  insert into upload_reset_batches (
    id, performed_by, is_crm_self, campaigns_archived, campaigns_inserted)
  values (v_batch, v_actor, p_is_crm_self, v_campaigns, v_inserted);

  insert into activity_logs (campaign_id, user_id, action, description)
  values (null, v_actor, 'UPLOAD_RESET',
    format('CRM uploaded a new sheet for the %s stream. Archived %s RUNNING PN(s), '
           || 'inserted %s. Calendar, QC-passed and production-ready PNs were not touched. '
           || 'Batch %s.',
           case when p_is_crm_self then 'CRM Self' else 'Category-led' end,
           v_campaigns, v_inserted, v_batch));

  return v_batch;
end $$;
revoke all on function public.reset_campaigns_with_archive(jsonb, boolean) from public;
grant execute on function public.reset_campaigns_with_archive(jsonb, boolean) to authenticated;

-- ═════════ VERIFY ═════════
select proname, prosecdef,
       exists (select 1 from unnest(coalesce(proconfig,'{}')) c where c like 'search_path=%') as has_sp
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and proname in ('reset_running_pns','running_pn_count','is_running_pn',
                  'reset_campaigns_with_archive')
order by 1;

notify pgrst, 'reload schema';
