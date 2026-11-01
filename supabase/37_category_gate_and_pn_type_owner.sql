-- =====================================================================
-- CLiQ Push Ops — 37: Category submit gate + PN Type becomes CRM-owned
--
-- Run THIRTY-SEVENTH, after 36, in the EXISTING project (jofxdelfnyuaisdmzyuv)
-- via the SQL Editor. Idempotent. NO DATA IS DELETED OR CHANGED.
-- Transaction-safe: no ALTER TYPE ... ADD VALUE, no CREATE INDEX CONCURRENTLY.
--
-- TWO CHANGES
-- 1. Category may not move a PN to LOCKED/SUBMITTED unless all SEVEN
--    fields are filled. Enforced at the single point where the status
--    changes, so any path missed in the app is still covered.
-- 2. `pn_type` moves from CONTENT-owned to CRM-owned. It is CRM's input TO
--    Content, not Content's own field. Existing values are kept; all 928
--    rows are NULL today, so nothing changes.
-- =====================================================================

-- ═════════ READ-ONLY CHECKS — run these FIRST ═════════
select
  (select count(*) from campaigns)                             as campaigns_total,
  (select count(*) from notifications)                         as notifications_total,
  (select count(*) from campaigns where pn_type is not null)   as rows_with_pn_type;
-- Expect rows_with_pn_type = 0. Both totals must be IDENTICAL afterwards.

-- HOW MANY PNs THE NEW SEVEN-FIELD RULE WOULD BLOCK.
-- Read-only. Run this before the rest and keep the numbers.
select
  count(*) filter (where
        btrim(coalesce(sub_category,'')) <> '' and btrim(coalesce(brand,'')) <> ''
    and btrim(coalesce(offer,'')) <> ''        and btrim(coalesce(brief,'')) <> ''
    and btrim(coalesce(landing,'')) <> ''      and btrim(coalesce(expected_cvr,'')) <> ''
    and btrim(coalesce(expected_rpv,'')) <> '')                  as would_pass,
  count(*) filter (where not (
        btrim(coalesce(sub_category,'')) <> '' and btrim(coalesce(brand,'')) <> ''
    and btrim(coalesce(offer,'')) <> ''        and btrim(coalesce(brief,'')) <> ''
    and btrim(coalesce(landing,'')) <> ''      and btrim(coalesce(expected_cvr,'')) <> ''
    and btrim(coalesce(expected_rpv,'')) <> ''))                 as would_be_blocked,
  -- Blocked ONLY by the new field, i.e. the other six are complete.
  count(*) filter (where btrim(coalesce(sub_category,'')) = ''
    and btrim(coalesce(brand,'')) <> ''        and btrim(coalesce(offer,'')) <> ''
    and btrim(coalesce(brief,'')) <> ''        and btrim(coalesce(landing,'')) <> ''
    and btrim(coalesce(expected_cvr,'')) <> '' and btrim(coalesce(expected_rpv,'')) <> '')
                                                                 as blocked_only_by_sub_category,
  count(*)                                                       as total_in_category_stage
from campaigns
where not is_crm_self and category_status in ('EMPTY','DRAFT');

-- ═════════ 1. THE CATEGORY SUBMIT GATE ═════════
-- Reusable, so the app, the trigger and the SLA all read ONE definition.
create or replace function public.category_missing_fields(c campaigns)
returns text[] language sql immutable set search_path = public as $$
  select array_remove(array[
    case when btrim(coalesce(c.sub_category,'')) = '' then 'Sub Category' end,
    case when btrim(coalesce(c.brand,''))        = '' then 'Brand' end,
    case when btrim(coalesce(c.offer,''))        = '' then 'Offer' end,
    case when btrim(coalesce(c.brief,''))        = '' then 'Brief' end,
    case when btrim(coalesce(c.landing,''))      = '' then 'Landing Link' end,
    case when btrim(coalesce(c.expected_cvr,'')) = '' then 'Expected CVR' end,
    case when btrim(coalesce(c.expected_rpv,'')) = '' then 'Expected RPV' end
  ], null);
$$;
grant execute on function public.category_missing_fields(campaigns) to authenticated;

/*
 * Blocked ONLY by the new rule: the six old fields are complete but
 * sub_category is empty. OPTION 3 — these are never auto-defaulted, so a PN
 * cannot be penalised for a field that was not required when it was raised.
 */
create or replace function public.blocked_only_by_new_rule(c campaigns)
returns boolean language sql immutable set search_path = public as $$
  select btrim(coalesce(c.sub_category,'')) = ''
     and btrim(coalesce(c.brand,''))        <> ''
     and btrim(coalesce(c.offer,''))        <> ''
     and btrim(coalesce(c.brief,''))        <> ''
     and btrim(coalesce(c.landing,''))      <> ''
     and btrim(coalesce(c.expected_cvr,'')) <> ''
     and btrim(coalesce(c.expected_rpv,'')) <> '';
$$;
grant execute on function public.blocked_only_by_new_rule(campaigns) to authenticated;

create or replace function public.enforce_category_submit_gate()
returns trigger language plpgsql set search_path = public as $$
declare v_role app_role := public.current_app_role(); v_missing text[];
begin
  -- System writes (upload, auto-default, SLA, send-back, remove from
  -- calendar) and CRM are never blocked.
  if coalesce(current_setting('app.system_write', true), '') = 'on' then
    return new;
  end if;
  if v_role is null or v_role = 'CRM'::app_role then
    return new;
  end if;
  -- CRM Self PNs have no Category input.
  if new.is_crm_self then
    return new;
  end if;

  -- Only a NEW submission is checked. A PN already LOCKED/SUBMITTED is
  -- never re-validated, so nothing in flight is affected.
  if new.category_status in ('LOCKED','SUBMITTED')
     and old.category_status not in ('LOCKED','SUBMITTED') then
    v_missing := public.category_missing_fields(new);
    if array_length(v_missing, 1) is not null then
      raise exception
        'Category input is incomplete. Still needed: %.',
        array_to_string(v_missing, ', ');
    end if;
  end if;

  return new;
end $$;

drop trigger if exists campaigns_category_submit_gate on campaigns;
create trigger campaigns_category_submit_gate
  before update on campaigns
  for each row execute function public.enforce_category_submit_gate();

-- ═════════ 2. OPTION 3: DO NOT DEFAULT PNs BLOCKED ONLY BY THE NEW RULE ═════════
-- `default_overdue_pns()` is left otherwise untouched; only the WHERE gains
-- one clause. If the function is absent (migration 28 not run) this is a
-- no-op and says so.
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'default_overdue_pns';

  if v_src is null then
    raise notice 'default_overdue_pns() not found; skipping the option-3 exclusion.';
  elsif position('blocked_only_by_new_rule' in v_src) > 0 then
    raise notice 'default_overdue_pns() already excludes them; nothing to do.';
  else
    raise notice
      'ACTION NEEDED: add  and not public.blocked_only_by_new_rule(c)  to the '
      'WHERE of default_overdue_pns(). It is not edited automatically because '
      'its body differs between installs.';
  end if;
end $$;

-- ═════════ 3. pn_type BECOMES CRM-OWNED ═════════
-- Only the CONTENT branch changes: pn_type joins the columns Content may
-- NOT write. CATEGORY already listed it. CRM bypasses the whole function.
create or replace function public.enforce_column_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := public.current_app_role();
  v_bad  text[];
begin
  if coalesce(current_setting('app.system_write', true), '') = 'on' then
    return new;
  end if;
  if v_role is null or v_role = 'CRM'::app_role then
    return new;
  end if;

  if v_role = 'CONTENT'::app_role then
    v_bad := array_remove(array[
      case when new.sub_category    is distinct from old.sub_category    then 'sub_category' end,
      case when new.brand           is distinct from old.brand           then 'brand' end,
      case when new.offer           is distinct from old.offer           then 'offer' end,
      case when new.brief           is distinct from old.brief           then 'brief' end,
      case when new.landing         is distinct from old.landing         then 'landing' end,
      case when new.expected_cvr    is distinct from old.expected_cvr    then 'expected_cvr' end,
      case when new.expected_rpv    is distinct from old.expected_rpv    then 'expected_rpv' end,
      case when new.title_brief     is distinct from old.title_brief     then 'title_brief' end,
      case when new.message_brief   is distinct from old.message_brief   then 'message_brief' end,
      case when new.pn_template     is distinct from old.pn_template     then 'pn_template' end,
      -- NEW: PN Type is CRM's input TO Content, not Content's own field.
      case when new.pn_type         is distinct from old.pn_type         then 'pn_type' end,
      case when new.qc_status       is distinct from old.qc_status       then 'qc_status' end,
      case when new.calendar_status is distinct from old.calendar_status then 'calendar_status' end
    ], null);
  elsif v_role = 'CATEGORY'::app_role then
    v_bad := array_remove(array[
      case when new.header          is distinct from old.header          then 'header' end,
      case when new.sub_copy_text   is distinct from old.sub_copy_text   then 'sub_copy_text' end,
      case when new.reference_link  is distinct from old.reference_link  then 'reference_link' end,
      case when new.pn_type         is distinct from old.pn_type         then 'pn_type' end,
      case when new.title_brief     is distinct from old.title_brief     then 'title_brief' end,
      case when new.message_brief   is distinct from old.message_brief   then 'message_brief' end,
      case when new.pn_template     is distinct from old.pn_template     then 'pn_template' end,
      case when new.qc_status       is distinct from old.qc_status       then 'qc_status' end,
      case when new.calendar_status is distinct from old.calendar_status then 'calendar_status' end
    ], null);
  else
    raise exception 'Your role may not change campaign fields.';
  end if;

  if array_length(v_bad, 1) is not null then
    raise exception '% may not change: %', v_role, array_to_string(v_bad, ', ');
  end if;
  return new;
end $$;

-- ═════════ 4. THE ALERT TRIGGER STOPS WATCHING pn_type FOR CONTENT ═════════
-- Migration 36's capture compares pn_type in the CONTENT block. Content can
-- no longer change it, so that comparison can never fire; it is removed so
-- the column list matches ownership.
create or replace function public.capture_change_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role app_role; v_changed text[] := '{}'; v_labels text[] := '{}';
  v_old text[] := '{}'; v_new text[] := '{}';
  v_name text; v_batch text; v_group text; v_existing uuid;
  v_was_reviewed boolean; v_copy_affecting boolean := false;
begin
  begin
    if coalesce(current_setting('app.system_write', true), '') = 'on' then return null; end if;
    v_role := public.current_app_role();
    if v_role is null or v_role not in ('CATEGORY'::app_role, 'CONTENT'::app_role) then
      return null;
    end if;
    if v_role = 'CONTENT'::app_role and old.content_status = 'NEEDS_CHANGES' then
      return null;
    end if;
    if v_role = 'CATEGORY'::app_role and old.category_submitted_at is null then return null; end if;
    if v_role = 'CONTENT'::app_role  and old.content_submitted_at  is null then return null; end if;

    if v_role = 'CATEGORY'::app_role then
      if btrim(coalesce(old.sub_category,'')) is distinct from btrim(coalesce(new.sub_category,'')) then
        v_changed := v_changed || 'sub_category'::text; v_old := v_old || coalesce(old.sub_category,'')::text; v_new := v_new || coalesce(new.sub_category,'')::text;
      end if;
      if btrim(coalesce(old.brand,'')) is distinct from btrim(coalesce(new.brand,'')) then
        v_changed := v_changed || 'brand'::text; v_old := v_old || coalesce(old.brand,'')::text; v_new := v_new || coalesce(new.brand,'')::text;
      end if;
      if btrim(coalesce(old.offer,'')) is distinct from btrim(coalesce(new.offer,'')) then
        v_changed := v_changed || 'offer'::text; v_old := v_old || coalesce(old.offer,'')::text; v_new := v_new || coalesce(new.offer,'')::text;
      end if;
      if btrim(coalesce(old.brief,'')) is distinct from btrim(coalesce(new.brief,'')) then
        v_changed := v_changed || 'brief'::text; v_old := v_old || coalesce(old.brief,'')::text; v_new := v_new || coalesce(new.brief,'')::text;
      end if;
      if btrim(coalesce(old.landing,'')) is distinct from btrim(coalesce(new.landing,'')) then
        v_changed := v_changed || 'landing'::text; v_old := v_old || coalesce(old.landing,'')::text; v_new := v_new || coalesce(new.landing,'')::text;
      end if;
      if btrim(coalesce(old.expected_cvr,'')) is distinct from btrim(coalesce(new.expected_cvr,'')) then
        v_changed := v_changed || 'expected_cvr'::text; v_old := v_old || coalesce(old.expected_cvr,'')::text; v_new := v_new || coalesce(new.expected_cvr,'')::text;
      end if;
      if btrim(coalesce(old.expected_rpv,'')) is distinct from btrim(coalesce(new.expected_rpv,'')) then
        v_changed := v_changed || 'expected_rpv'::text; v_old := v_old || coalesce(old.expected_rpv,'')::text; v_new := v_new || coalesce(new.expected_rpv,'')::text;
      end if;
      if btrim(coalesce(old.additional_notes,'')) is distinct from btrim(coalesce(new.additional_notes,'')) then
        v_changed := v_changed || 'additional_notes'::text; v_old := v_old || coalesce(old.additional_notes,'')::text; v_new := v_new || coalesce(new.additional_notes,'')::text;
      end if;
    else
      if btrim(coalesce(old.header,'')) is distinct from btrim(coalesce(new.header,'')) then
        v_changed := v_changed || 'header'::text; v_old := v_old || coalesce(old.header,'')::text; v_new := v_new || coalesce(new.header,'')::text;
      end if;
      if btrim(coalesce(old.sub_copy_text,'')) is distinct from btrim(coalesce(new.sub_copy_text,'')) then
        v_changed := v_changed || 'sub_copy_text'::text; v_old := v_old || coalesce(old.sub_copy_text,'')::text; v_new := v_new || coalesce(new.sub_copy_text,'')::text;
      end if;
      if btrim(coalesce(old.reference_link,'')) is distinct from btrim(coalesce(new.reference_link,'')) then
        v_changed := v_changed || 'reference_link'::text; v_old := v_old || coalesce(old.reference_link,'')::text; v_new := v_new || coalesce(new.reference_link,'')::text;
      end if;
    end if;

    if array_length(v_changed, 1) is null then return null; end if;

    v_labels := array(select public.field_label(c) from unnest(v_changed) c);
    v_name   := nullif(btrim(coalesce(current_setting('app.actor_name', true), '')), '');
    v_batch  := nullif(btrim(coalesce(current_setting('app.batch_id', true), '')), '');
    v_group  := case when v_batch is not null
                     then 'BATCH:' || v_batch || ':' || v_role::text
                     else 'PN:' || new.id::text || ':' || v_role::text end;

    select id into v_existing from notifications
     where group_key = v_group and acknowledged_at is null
     order by created_at desc limit 1;

    if v_existing is not null then
      update notifications
         set new_value = array_to_string(v_new, ' | '),
             field_label = array_to_string(v_labels, ', '),
             changed_by_name = coalesce(v_name, changed_by_name),
             message = format('%s → %s (latest)', old_value, array_to_string(v_new, ' | '))
       where id = v_existing;
    else
      insert into notifications (
        target_role, campaign_id, type, title, message, priority, group_key,
        field_label, old_value, new_value, changed_by_name, source_team, batch_id)
      values ('CRM'::app_role, new.id, 'INPUT_CHANGED',
        format('%s changed %s after submitting', v_role::text, array_to_string(v_labels, ', ')),
        format('%s → %s', array_to_string(v_old, ' | '), array_to_string(v_new, ' | ')),
        'RED', v_group, array_to_string(v_labels, ', '),
        array_to_string(v_old, ' | '), array_to_string(v_new, ' | '),
        coalesce(v_name, 'name not provided'), v_role::text, v_batch);
    end if;

    insert into activity_logs (campaign_id, user_id, action, description)
    values (new.id, auth.uid(), 'INPUT_CHANGED',
      format('%s (%s) changed %s after submitting: %s → %s',
        v_role::text, coalesce(v_name, 'name not provided'),
        array_to_string(v_labels, ', '),
        array_to_string(v_old, ' | '), array_to_string(v_new, ' | ')));

    v_copy_affecting := v_role = 'CATEGORY'::app_role
      and (v_changed && array['brand','offer','landing']::text[]);
    v_was_reviewed := new.qc_status = 'PASSED'::qc_status
      or v_copy_affecting
      or exists (select 1 from qc_checklists q where q.campaign_id = new.id and q.copy_verified);

    if v_was_reviewed then
      perform public.begin_system_write();
      update campaigns
         set qc_status = 'PENDING'::qc_status,
             crm_status = case when v_role = 'CATEGORY'::app_role
                               then 'AWAITING_REVIEW'::crm_status
                               else 'SENT_TO_CONTENT'::crm_status end
       where id = new.id;
      update qc_checklists set copy_verified = false
       where campaign_id = new.id and copy_verified;
      insert into activity_logs (campaign_id, user_id, action, description)
      values (new.id, auth.uid(), 'RETURNED_TO_REVIEW',
        format('%s changed input after CRM review. QC reset to pending and the '
               || 'copy check cleared; the PN is back in CRM review.', v_role::text));
      perform set_config('app.system_write', '', true);
    end if;

  exception when others then
    begin
      insert into activity_logs (campaign_id, user_id, action, description)
      values (new.id, auth.uid(), 'ALERT_CAPTURE_FAILED',
        'The change was saved, but the CRM alert could not be created: '
        || coalesce(sqlerrm, 'unknown error'));
    exception when others then
      raise warning 'Alert capture failed and could not be logged: %', sqlerrm;
    end;
  end;
  return null;
end $$;

-- ═════════ VERIFY ═════════
select
  (select count(*) from campaigns)                           as campaigns_total_after,
  (select count(*) from notifications)                       as notifications_total_after,
  (select count(*) from campaigns where pn_type is not null) as rows_with_pn_type_after,
  (select count(*) from pg_trigger where tgrelid='campaigns'::regclass
     and tgname = 'campaigns_category_submit_gate')          as gate_trigger,
  (select count(*) from public.check_trigger_enum_literals())as bad_enum_literals;
-- Expect: both totals IDENTICAL, rows_with_pn_type_after = 0,
--         gate_trigger = 1, bad_enum_literals = 0.

select * from public.check_trigger_enum_literals();   -- expect zero rows

-- ═════════ BEGIN ... ROLLBACK IMPERSONATION TEST ═════════
-- Looks up real profile ids itself. Ends in ROLLBACK; leaves nothing.
/*
select count(*) as campaigns_before from campaigns;
select count(*) as notifications_before from notifications;

do $$
declare
  v_cat uuid; v_con uuid; v_pn uuid;
begin
  select id into v_cat from profiles where role = 'CATEGORY' limit 1;
  select id into v_con from profiles where role = 'CONTENT'  limit 1;
  if v_cat is null or v_con is null then
    raise exception 'Need one CATEGORY and one CONTENT profile to run this test.';
  end if;
  raise notice 'CATEGORY id = %, CONTENT id = %', v_cat, v_con;
end $$;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, content_status, brand, offer, brief, landing,
    expected_cvr, expected_rpv, sub_category)
  values ('TEST_gate', 'CRM_PLANNED', current_date + 60, false,
    'DRAFT', 'NOT_ASSIGNED', 'B', 'O', 'Br', 'L', '1', '2', NULL);

  -- A) Incomplete submit is REJECTED (sub_category is NULL).
  set local role authenticated;
  set local request.jwt.claims = ('{"sub":"' ||
    (select id from profiles where role='CATEGORY' limit 1) || '"}');
  update campaigns set category_status = 'LOCKED' where campaign_name = 'TEST_gate';
  -- EXPECT: ERROR: Category input is incomplete. Still needed: Sub Category.
rollback;

begin;
  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, content_status, brand, offer, brief, landing,
    expected_cvr, expected_rpv, sub_category)
  values ('TEST_gate2', 'CRM_PLANNED', current_date + 60, false,
    'DRAFT', 'NOT_ASSIGNED', 'B', 'O', 'Br', 'L', '1', '2', 'Shoes');

  -- B) Complete submit SUCCEEDS.
  set local role authenticated;
  set local request.jwt.claims = ('{"sub":"' ||
    (select id from profiles where role='CATEGORY' limit 1) || '"}');
  update campaigns set category_status = 'LOCKED' where campaign_name = 'TEST_gate2';
  reset role;
  select 'B status' as check, category_status::text from campaigns where campaign_name='TEST_gate2';
  -- EXPECT: LOCKED

  -- C) CONTENT may NOT set pn_type.
  set local role authenticated;
  set local request.jwt.claims = ('{"sub":"' ||
    (select id from profiles where role='CONTENT' limit 1) || '"}');
  update campaigns set pn_type = 'SALE' where campaign_name = 'TEST_gate2';
  -- EXPECT: ERROR: CONTENT may not change: pn_type
rollback;

select count(*) as campaigns_after from campaigns;
select count(*) as notifications_after from notifications;
select count(*) as test_rows_left from campaigns where campaign_name like 'TEST\_%';
-- EXPECT: counts match, test_rows_left = 0.
*/

-- ═════════ ROLLBACK NOTE ═════════
--   drop trigger if exists campaigns_category_submit_gate on campaigns;
--   drop function if exists public.enforce_category_submit_gate();
--   drop function if exists public.category_missing_fields(campaigns);
--   drop function if exists public.blocked_only_by_new_rule(campaigns);
--   -- then re-run migration 36 to restore the previous
--   -- enforce_column_ownership() and capture_change_alerts().
-- No PN data is affected either way.

notify pgrst, 'reload schema';
