-- =====================================================================
-- CLiQ Push Ops — 36: FIX migration 35 (no new features)
--
-- Run THIRTY-SIXTH, after 35, in the EXISTING project via the SQL Editor.
-- Idempotent. NO DATA IS DELETED OR CHANGED by running this file.
-- Transaction-safe: no ALTER TYPE ... ADD VALUE, no CREATE INDEX CONCURRENTLY.
--
-- WHAT WAS BROKEN IN 35
-- `new.crm_status = 'REVIEWED'` — 'REVIEWED' is NOT a crm_status value
-- (NOT_STARTED, AWAITING_REVIEW, IN_PLANNING, SENT_TO_CONTENT, FINAL_QC,
-- READY). The comparison raised `invalid input value for enum` every time
-- the trigger reached it, which is AFTER the alert and Activity inserts —
-- so the exception handler rolled both back and left only
-- ALERT_CAPTURE_FAILED. No red alert could ever be created.
--
-- ALSO FIXED
--  * The nested QC reset ran as the acting team, so
--    enforce_column_ownership() blocked it (Content may not write
--    qc_status). It now runs inside begin_system_write().
--  * Returning a PN to "Pending CRM Review" needs `copy_verified` cleared,
--    not just qc_status — the bucket reads the checklist, not crm_status.
--  * notifications could be inserted and updated from the browser.
-- =====================================================================

-- ═════════ READ-ONLY CHECKS — run these FIRST ═════════
select
  (select count(*) from campaigns)                                   as campaigns_total,
  (select count(*) from notifications)                               as notifications_total,
  (select count(*) from activity_logs where action='ALERT_CAPTURE_FAILED')
                                                                     as capture_failures,
  (select count(*) from notifications where priority='RED')          as red_alerts;
-- Both totals must be IDENTICAL after this file runs.

select policyname, cmd from pg_policies
where schemaname='public' and tablename='notifications' order by cmd, policyname;
-- Before: notif_insert(INSERT), notif_read(SELECT),
--         notifications_read_own_role(SELECT), notif_update(UPDATE).
-- After:  notif_insert(INSERT), notif_read(SELECT), notif_update(UPDATE).

-- ═════════ 1. DROP THE REDUNDANT POLICY ═════════
-- `notifications_read_own_role` is a strict SUBSET of `notif_read`
-- ((user_id = auth.uid()) OR (target_role = current_app_role())), so
-- removing it changes nothing about what anyone can read.
drop policy if exists notifications_read_own_role on notifications;

-- ═════════ 2. THE CORRECTED CAPTURE TRIGGER ═════════
create or replace function public.capture_change_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role     app_role;
  v_changed  text[] := '{}';
  v_labels   text[] := '{}';
  v_old      text[] := '{}';
  v_new      text[] := '{}';
  v_name     text;
  v_batch    text;
  v_group    text;
  v_existing uuid;
  v_was_reviewed boolean;
  v_copy_affecting boolean := false;
begin
  begin
    if coalesce(current_setting('app.system_write', true), '') = 'on' then
      return null;
    end if;

    v_role := public.current_app_role();
    if v_role is null or v_role not in ('CATEGORY'::app_role, 'CONTENT'::app_role) then
      return null;
    end if;

    -- Content's edits during NEEDS_CHANGES are the requested rework.
    if v_role = 'CONTENT'::app_role and old.content_status = 'NEEDS_CHANGES' then
      return null;
    end if;

    -- "After submission" comes from the stamps, never category_status alone.
    if v_role = 'CATEGORY'::app_role and old.category_submitted_at is null then
      return null;
    end if;
    if v_role = 'CONTENT'::app_role and old.content_submitted_at is null then
      return null;
    end if;

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
      if btrim(coalesce(old.pn_type,'')) is distinct from btrim(coalesce(new.pn_type,'')) then
        v_changed := v_changed || 'pn_type'::text; v_old := v_old || coalesce(old.pn_type,'')::text; v_new := v_new || coalesce(new.pn_type,'')::text;
      end if;
    end if;

    if array_length(v_changed, 1) is null then
      return null;                                   -- no-op save
    end if;

    v_labels := array(select public.field_label(c) from unnest(v_changed) c);
    v_name   := nullif(btrim(coalesce(current_setting('app.actor_name', true), '')), '');
    v_batch  := nullif(btrim(coalesce(current_setting('app.batch_id', true), '')), '');

    v_group := case when v_batch is not null
                    then 'BATCH:' || v_batch || ':' || v_role::text
                    else 'PN:' || new.id::text || ':' || v_role::text end;

    select id into v_existing from notifications
     where group_key = v_group and acknowledged_at is null
     order by created_at desc limit 1;

    if v_existing is not null then
      update notifications
         set new_value       = array_to_string(v_new, ' | '),
             field_label     = array_to_string(v_labels, ', '),
             changed_by_name = coalesce(v_name, changed_by_name),
             message = format('%s → %s (latest)',
               old_value, array_to_string(v_new, ' | '))
       where id = v_existing;
    else
      insert into notifications (
        target_role, campaign_id, type, title, message, priority, group_key,
        field_label, old_value, new_value, changed_by_name, source_team, batch_id)
      values ('CRM'::app_role, new.id, 'INPUT_CHANGED',
        format('%s changed %s after submitting',
          v_role::text, array_to_string(v_labels, ', ')),
        format('%s → %s', array_to_string(v_old, ' | '),
                          array_to_string(v_new, ' | ')),
        'RED', v_group,
        array_to_string(v_labels, ', '),
        array_to_string(v_old, ' | '), array_to_string(v_new, ' | '),
        coalesce(v_name, 'name not provided'), v_role::text, v_batch);
    end if;

    insert into activity_logs (campaign_id, user_id, action, description)
    values (new.id, auth.uid(), 'INPUT_CHANGED',
      format('%s (%s) changed %s after submitting: %s → %s',
        v_role::text, coalesce(v_name, 'name not provided'),
        array_to_string(v_labels, ', '),
        array_to_string(v_old, ' | '), array_to_string(v_new, ' | ')));

    /*
     * FIX: 'REVIEWED' is not a crm_status value. The real signal that CRM
     * has reviewed the copy is `copy_verified` on the checklist, or
     * qc_status = 'PASSED'/'FINAL_QC'.
     *
     * The reset runs inside begin_system_write() so enforce_column_ownership
     * and the calendar lock do not block it — without that, Content writing
     * qc_status raised and rolled the whole alert back.
     */
    /*
     * ITEM 4: a Category change to Brand, Offer or Landing can make copy
     * that Content already wrote wrong, so the copy check is cleared even
     * when QC had not passed — CRM must look again.
     */
    v_copy_affecting := v_role = 'CATEGORY'::app_role
      and (v_changed && array['brand','offer','landing']::text[]);

    v_was_reviewed := new.qc_status = 'PASSED'::qc_status
      or v_copy_affecting
      or exists (select 1 from qc_checklists q
                  where q.campaign_id = new.id and q.copy_verified);

    if v_was_reviewed then
      perform public.begin_system_write();

      -- (b) A CATEGORY change goes back to CRM's review of CATEGORY input;
      -- (a) a CONTENT change goes back to copy review.
      update campaigns
         set qc_status = 'PENDING'::qc_status,
             crm_status = case when v_role = 'CATEGORY'::app_role
                               then 'AWAITING_REVIEW'::crm_status
                               else 'SENT_TO_CONTENT'::crm_status end
       where id = new.id;

      -- The bucket reads the CHECKLIST, not crm_status: clearing
      -- copy_verified is what actually returns the PN to Pending CRM Review
      -- rather than leaving it in Ready for Final QC.
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

-- ═════════ 3. NOTIFICATIONS SECURITY ═════════
-- INSERT: the browser may still create the ordinary workflow notifications
-- the app sends (services/campaigns.ts `notify()`), but NEVER a RED/AMBER
-- alert or an INPUT_CHANGED row. Those come only from SECURITY DEFINER
-- functions and triggers, which bypass RLS.
drop policy if exists notif_insert on notifications;
create policy notif_insert on notifications
  for insert to authenticated
  with check (
    public.current_app_role() <> 'EXECUTIVE'::app_role
    and coalesce(priority, 'NORMAL') = 'NORMAL'
    and type <> 'INPUT_CHANGED'
  );

-- UPDATE: the browser may only mark a row read. Acknowledging an alert goes
-- through acknowledge_alert(), which requires CRM and a typed name.
drop policy if exists notif_update on notifications;
create policy notif_update on notifications
  for update to authenticated
  using (
    public.current_app_role() <> 'EXECUTIVE'::app_role
    and (user_id = auth.uid() or target_role = public.current_app_role())
  )
  with check (
    -- Nothing but is_read may move. Every other column must be unchanged,
    -- which a row-level WITH CHECK cannot express, so the columns are
    -- revoked instead (below) and this keeps the row scope.
    public.current_app_role() <> 'EXECUTIVE'::app_role
    and (user_id = auth.uid() or target_role = public.current_app_role())
  );

-- Column privileges are what actually stop a browser rewriting the detail.
revoke update on notifications from authenticated;
grant update (is_read) on notifications to authenticated;
grant select, insert on notifications to authenticated;

-- ═════════ 3b. CAMPAIGNS UPDATE POLICY ═════════
-- The old policy allowed Category only in EMPTY/DRAFT and Content only in
-- NOT_ASSIGNED/PENDING/NEEDS_CHANGES, so an edit after submitting silently
-- affected ZERO rows. That is why Stage A's "edit until the calendar push"
-- never worked and why no alert could ever fire.
--
-- USING decides which rows may be targeted; WITH CHECK decides what the row
-- may become — so an edit cannot move a row OUT of the editable set.
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
-- EXECUTIVE appears in neither branch, so it can update nothing.
-- `calendar_status is distinct from 'UPDATED'` in WITH CHECK means a team
-- also cannot push a PN onto the calendar itself.

-- ═════════ 3c. NO STATUS REGRESSION ═════════
-- A team must not move its own status backwards after submitting: doing so
-- would make later edits look like first-time drafting and skip the alerts.
-- A trigger, not WITH CHECK, because the rule compares OLD with NEW.
create or replace function public.forbid_status_regression()
returns trigger language plpgsql set search_path = public as $$
declare v_role app_role := public.current_app_role();
begin
  if coalesce(current_setting('app.system_write', true), '') = 'on' then
    return new;
  end if;
  if v_role is null or v_role = 'CRM'::app_role then
    return new;                      -- CRM may correct a status deliberately
  end if;

  if v_role = 'CATEGORY'::app_role
     and old.category_status in ('LOCKED','SUBMITTED')
     and new.category_status in ('EMPTY','DRAFT') then
    raise exception
      'Category input has already been submitted and cannot be moved back to %.',
      new.category_status;
  end if;

  if v_role = 'CONTENT'::app_role
     and old.content_status = 'SUBMITTED'
     and new.content_status in ('NOT_ASSIGNED','PENDING') then
    raise exception
      'Copy has already been submitted and cannot be moved back to %.',
      new.content_status;
  end if;

  return new;
end $$;

drop trigger if exists campaigns_no_status_regression on campaigns;
create trigger campaigns_no_status_regression
  before update on campaigns
  for each row execute function public.forbid_status_regression();

-- ═════════ 3d. qc_checklists MUST NOT BLOCK THE RESET ═════════
-- The trigger clears copy_verified as the acting team, so RLS on
-- qc_checklists would block it. `capture_change_alerts()` is SECURITY
-- DEFINER, which bypasses RLS on tables it touches, and it additionally
-- sets app.system_write. This confirms the owner is a superuser-equivalent
-- role so the bypass holds.
do $$ begin
  if not exists (
    select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
    where p.proname = 'capture_change_alerts'
      and (r.rolsuper or r.rolbypassrls)
  ) then
    raise notice
      'capture_change_alerts is not owned by a BYPASSRLS role; the copy_verified '
      'clear may be blocked by RLS. Run: alter function public.capture_change_alerts() owner to postgres;';
  end if;
end $$;

-- ═════════ 3e. OWNERSHIP MUST HONOUR SYSTEM WRITES ═════════
-- `enforce_column_ownership()` (migration 33) predates `app.system_write`
-- and so blocked the trigger's own QC reset with
-- "CONTENT may not change: qc_status". Only the bypass is added; the
-- ownership lists are unchanged.
create or replace function public.enforce_column_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := public.current_app_role();
  v_bad  text[];
begin
  -- NEW: a marked system write bypasses ownership, exactly as it bypasses
  -- the calendar lock and the human_rev counter.
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

-- ═════════ 4. ENUM-LITERAL GUARD ═════════
-- Fails loudly if any trigger function body references a crm_status,
-- qc_status, content_status or category_status literal that does not exist.
-- This is the check that would have caught migration 35's 'REVIEWED'.
create or replace function public.check_trigger_enum_literals()
returns table (function_name text, bad_literal text, enum_name text)
language plpgsql stable set search_path = public as $$
declare r record; m text; v_enum text;
begin
  for r in
    select p.proname, pg_get_functiondef(p.oid) as src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    foreach v_enum in array array['crm_status','qc_status','content_status','category_status'] loop
      for m in
        -- Any 'LITERAL'::enum cast anywhere in the body. This is the form
        -- that let 'FINAL_QC'::qc_status through an earlier, weaker check.
        select (regexp_matches(r.src, '''([A-Z_]+)''\s*::\s*' || v_enum, 'g'))[1]
        union
        -- And comparisons written without a cast.
        select (regexp_matches(r.src,
          v_enum || '\s*(?:=|<>)\s*''([A-Z_]+)''', 'g'))[1]
      loop
        if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
                       where t.typname = v_enum and e.enumlabel = m) then
          function_name := r.proname; bad_literal := m; enum_name := v_enum;
          return next;
        end if;
      end loop;
    end loop;
  end loop;
end $$;
grant execute on function public.check_trigger_enum_literals() to authenticated;

-- ═════════ VERIFY ═════════
select
  (select count(*) from campaigns)      as campaigns_total_after,
  (select count(*) from notifications)  as notifications_total_after,
  (select count(*) from pg_policies where schemaname='public'
     and tablename='notifications')     as policy_count,
  (select count(*) from public.check_trigger_enum_literals()) as bad_enum_literals;
-- Expect: both totals IDENTICAL, policy_count = 3, bad_enum_literals = 0.

select * from public.check_trigger_enum_literals();
-- Expect: zero rows.

-- ═════════ OPT-IN BACKFILL (run ONLY if you decide to) ═════════
-- Stamps the submission times for PNs already submitted and NOT on the
-- calendar, so edits to them start alerting. It touches ONLY those two
-- columns. Count first:
/*
select
  count(*) filter (where category_status in ('LOCKED','SUBMITTED')
                     and category_submitted_at is null
                     and calendar_status is distinct from 'UPDATED')  as category_to_stamp,
  count(*) filter (where content_status = 'SUBMITTED'
                     and content_submitted_at is null
                     and calendar_status is distinct from 'UPDATED')  as content_to_stamp
from campaigns;

-- Then, deliberately:
select public.begin_system_write();
update campaigns set category_submitted_at = coalesce(updated_at, created_at)
 where category_status in ('LOCKED','SUBMITTED')
   and category_submitted_at is null
   and calendar_status is distinct from 'UPDATED';
update campaigns set content_submitted_at = coalesce(updated_at, created_at)
 where content_status = 'SUBMITTED'
   and content_submitted_at is null
   and calendar_status is distinct from 'UPDATED';
*/

-- ═════════ ROLLBACK NOTE ═════════
--   Re-run migration 35 to restore the previous (broken) trigger, then:
--   drop policy if exists notif_insert on notifications;
--   drop policy if exists notif_update on notifications;
--   -- and re-run 02_rls.sql to restore the original two.
--   grant update on notifications to authenticated;   -- undo column limits
--   drop function if exists public.check_trigger_enum_literals();
-- No PN data is affected either way.

notify pgrst, 'reload schema';
