-- =====================================================================
-- CLiQ Push Ops — 35: change alerts (B1)
--
-- Run THIRTY-FIFTH, after 34, in the EXISTING project via the SQL Editor.
-- Idempotent. NO DATA IS DELETED OR CHANGED.
-- Transaction-safe: no ALTER TYPE ... ADD VALUE, no CREATE INDEX CONCURRENTLY.
--
-- WHAT IT DOES
-- An AFTER UPDATE trigger on `campaigns` records a RED alert for CRM when
-- Category or Content changes its own input AFTER submitting it. Alerts are
-- created by the DATABASE, so no write path — drawer, grid, import, bulk
-- fill — can skip them.
--
-- DEFENSIVE BY DESIGN (your B1.6 point)
-- The whole capture runs inside a BEGIN ... EXCEPTION WHEN others block.
-- If anything in it fails, the EDIT STILL SUCCEEDS and the failure is
-- written to activity_logs as 'ALERT_CAPTURE_FAILED'. A bug here can never
-- wedge editing, and it can never fail silently either.
-- =====================================================================

-- ═════════ READ-ONLY CHECKS — run these FIRST ═════════
select
  (select count(*) from campaigns)                                as campaigns_total,
  (select count(*) from notifications)                            as notifications_total,
  (select count(*) from pg_trigger where tgrelid='campaigns'::regclass
     and tgname = 'campaigns_change_alerts')                      as alert_trigger,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='campaigns'
      and column_name in ('category_submitted_at','content_submitted_at'))
                                                                  as submit_stamps;
-- Expect alert_trigger = 0 and submit_stamps = 0 on a first run.
-- campaigns_total and notifications_total must be IDENTICAL afterwards.

-- ═════════ 1. RELIABLE "AFTER SUBMISSION" SIGNALS ═════════
-- `category_status` is written inconsistently, so it is NEVER used alone.
-- These stamps are set the first time each team submits, and are the signal
-- the trigger reads. Existing rows stay NULL, which means "never submitted"
-- — so no historical PN can produce a retrospective alert.
alter table campaigns add column if not exists category_submitted_at timestamptz;
alter table campaigns add column if not exists content_submitted_at  timestamptz;

create or replace function public.stamp_submission()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.category_status in ('LOCKED','SUBMITTED')
     and old.category_status is distinct from new.category_status
     and new.category_submitted_at is null then
    new.category_submitted_at := now();
  end if;
  if new.content_status = 'SUBMITTED'
     and old.content_status is distinct from new.content_status
     and new.content_submitted_at is null then
    new.content_submitted_at := now();
  end if;
  return new;
end $$;

drop trigger if exists campaigns_stamp_submission on campaigns;
create trigger campaigns_stamp_submission
  before update on campaigns
  for each row execute function public.stamp_submission();

-- ═════════ 2. ALERT COLUMNS ═════════
-- Reuses migration 31's priority / group_key / acknowledged_* on
-- `notifications`. These add the change detail.
alter table notifications add column if not exists field_label  text;
alter table notifications add column if not exists old_value    text;
alter table notifications add column if not exists new_value    text;
alter table notifications add column if not exists changed_by_name text;
alter table notifications add column if not exists source_team  text;
alter table notifications add column if not exists batch_id     text;

create index if not exists notifications_open_red_idx
  on notifications (target_role, created_at desc)
  where acknowledged_at is null and priority = 'RED';

-- ═════════ 3. HUMAN-READABLE LABELS ═════════
create or replace function public.field_label(p_column text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    (array['sub_category','Sub Category','brand','Brand','offer','Offer',
           'brief','Category Brief','landing','Landing Link',
           'expected_cvr','Expected CVR','expected_rpv','Expected RPV',
           'additional_notes','Comments',
           'header','Header','sub_copy_text','Sub Copy',
           'reference_link','Reference Link','pn_type','PN Type',
           'title_brief','Title Brief','message_brief','Message Brief',
           'pn_template','PN Template','creative_requirements','Creative Requirements'
          ])[array_position(array[
           'sub_category','brand','offer','brief','landing','expected_cvr',
           'expected_rpv','additional_notes','header','sub_copy_text',
           'reference_link','pn_type','title_brief','message_brief',
           'pn_template','creative_requirements'], p_column) * 2],
    p_column);
$$;

-- ═════════ 4. THE CAPTURE TRIGGER ═════════
create or replace function public.capture_change_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role    app_role;
  v_changed text[] := '{}';
  v_labels  text[] := '{}';
  v_old     text[] := '{}';
  v_new     text[] := '{}';
  v_name    text;
  v_batch   text;
  v_group   text;
  v_existing uuid;
begin
  begin
    -- System writes never alert.
    if coalesce(current_setting('app.system_write', true), '') = 'on' then
      return null;
    end if;

    v_role := public.current_app_role();
    -- B1: only CATEGORY and CONTENT produce RED alerts in this round.
    -- CRM's own edits are Activity-only here; amber alerts are B2.
    if v_role is null or v_role not in ('CATEGORY'::app_role, 'CONTENT'::app_role) then
      return null;
    end if;

    -- Content's edits while NEEDS_CHANGES are the requested rework.
    if v_role = 'CONTENT'::app_role and old.content_status = 'NEEDS_CHANGES' then
      return null;
    end if;

    -- "After submission", from the stamps, never category_status alone.
    if v_role = 'CATEGORY'::app_role and old.category_submitted_at is null then
      return null;
    end if;
    if v_role = 'CONTENT'::app_role and old.content_submitted_at is null then
      return null;
    end if;

    -- Compared explicitly per column: clearer than dynamic SQL, and it
    -- cannot be tricked by a column name.

    if v_role = 'CATEGORY'::app_role then
      if btrim(coalesce(old.sub_category,'')) is distinct from btrim(coalesce(new.sub_category,'')) then
        v_changed := v_changed || 'sub_category'; v_old := v_old || coalesce(old.sub_category,''); v_new := v_new || coalesce(new.sub_category,'');
      end if;
      if btrim(coalesce(old.brand,'')) is distinct from btrim(coalesce(new.brand,'')) then
        v_changed := v_changed || 'brand'; v_old := v_old || coalesce(old.brand,''); v_new := v_new || coalesce(new.brand,'');
      end if;
      if btrim(coalesce(old.offer,'')) is distinct from btrim(coalesce(new.offer,'')) then
        v_changed := v_changed || 'offer'; v_old := v_old || coalesce(old.offer,''); v_new := v_new || coalesce(new.offer,'');
      end if;
      if btrim(coalesce(old.brief,'')) is distinct from btrim(coalesce(new.brief,'')) then
        v_changed := v_changed || 'brief'; v_old := v_old || coalesce(old.brief,''); v_new := v_new || coalesce(new.brief,'');
      end if;
      if btrim(coalesce(old.landing,'')) is distinct from btrim(coalesce(new.landing,'')) then
        v_changed := v_changed || 'landing'; v_old := v_old || coalesce(old.landing,''); v_new := v_new || coalesce(new.landing,'');
      end if;
      if btrim(coalesce(old.expected_cvr,'')) is distinct from btrim(coalesce(new.expected_cvr,'')) then
        v_changed := v_changed || 'expected_cvr'; v_old := v_old || coalesce(old.expected_cvr,''); v_new := v_new || coalesce(new.expected_cvr,'');
      end if;
      if btrim(coalesce(old.expected_rpv,'')) is distinct from btrim(coalesce(new.expected_rpv,'')) then
        v_changed := v_changed || 'expected_rpv'; v_old := v_old || coalesce(old.expected_rpv,''); v_new := v_new || coalesce(new.expected_rpv,'');
      end if;
      if btrim(coalesce(old.additional_notes,'')) is distinct from btrim(coalesce(new.additional_notes,'')) then
        v_changed := v_changed || 'additional_notes'; v_old := v_old || coalesce(old.additional_notes,''); v_new := v_new || coalesce(new.additional_notes,'');
      end if;
    else
      if btrim(coalesce(old.header,'')) is distinct from btrim(coalesce(new.header,'')) then
        v_changed := v_changed || 'header'; v_old := v_old || coalesce(old.header,''); v_new := v_new || coalesce(new.header,'');
      end if;
      if btrim(coalesce(old.sub_copy_text,'')) is distinct from btrim(coalesce(new.sub_copy_text,'')) then
        v_changed := v_changed || 'sub_copy_text'; v_old := v_old || coalesce(old.sub_copy_text,''); v_new := v_new || coalesce(new.sub_copy_text,'');
      end if;
      if btrim(coalesce(old.reference_link,'')) is distinct from btrim(coalesce(new.reference_link,'')) then
        v_changed := v_changed || 'reference_link'; v_old := v_old || coalesce(old.reference_link,''); v_new := v_new || coalesce(new.reference_link,'');
      end if;
      if btrim(coalesce(old.pn_type,'')) is distinct from btrim(coalesce(new.pn_type,'')) then
        v_changed := v_changed || 'pn_type'; v_old := v_old || coalesce(old.pn_type,''); v_new := v_new || coalesce(new.pn_type,'');
      end if;
    end if;

    if array_length(v_changed, 1) is null then
      return null;                       -- no-op save: nothing to report
    end if;

    v_labels := array(select public.field_label(c) from unnest(v_changed) c);

    -- The typed name the app supplies per transaction.
    v_name  := nullif(btrim(coalesce(current_setting('app.actor_name', true), '')), '');
    v_batch := nullif(btrim(coalesce(current_setting('app.batch_id', true), '')), '');

    -- Grouping: a batch id groups a bulk save or import into ONE alert.
    -- Without one, each PN gets its own — never a wrong group.
    v_group := case when v_batch is not null
                    then 'BATCH:' || v_batch || ':' || v_role::text
                    else 'PN:' || new.id::text || ':' || v_role::text end;

    -- Merge into the existing UNACKNOWLEDGED alert for the same key, so a
    -- second edit before review shows the NET change rather than two rows.
    select id into v_existing from notifications
     where group_key = v_group and acknowledged_at is null
     order by created_at desc limit 1;

    if v_existing is not null then
      update notifications
         set new_value       = array_to_string(v_new, ' | '),
             field_label     = array_to_string(v_labels, ', '),
             changed_by_name = coalesce(v_name, changed_by_name),
             message = format('%s changed %s. Now: %s',
               v_role::text, array_to_string(v_labels, ', '),
               array_to_string(v_new, ' | '))
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

    -- Every step is kept in Activity, even when alerts merge.
    insert into activity_logs (campaign_id, user_id, action, description)
    values (new.id, auth.uid(), 'INPUT_CHANGED',
      format('%s (%s) changed %s after submitting: %s → %s',
        v_role::text, coalesce(v_name, 'name not provided'),
        array_to_string(v_labels, ', '),
        array_to_string(v_old, ' | '), array_to_string(v_new, ' | ')));

    -- A reviewed or QC-passed PN goes back to CRM review.
    if new.qc_status = 'PASSED' or new.crm_status = 'REVIEWED' then
      update campaigns
         set qc_status  = 'PENDING'::qc_status,
             crm_status = 'SENT_TO_CONTENT'::crm_status
       where id = new.id;
    end if;

  exception when others then
    /*
     * DEFENSIVE: the edit has already been applied (this is AFTER UPDATE).
     * Swallowing the error here lets the user's save succeed, and the
     * failure is recorded so it is never silent.
     */
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

drop trigger if exists campaigns_change_alerts on campaigns;
create trigger campaigns_change_alerts
  after update on campaigns
  for each row execute function public.capture_change_alerts();

-- ═════════ 5. ACKNOWLEDGE ═════════
create or replace function public.acknowledge_alert(
  p_notification_id uuid, p_by_name text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crm() then
    raise exception 'Only CRM can acknowledge an input-change alert.';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Your name is required to mark an alert reviewed.';
  end if;
  update notifications
     set acknowledged_at = now(), acknowledged_by = auth.uid(),
         acknowledged_name = btrim(p_by_name)
   where id = p_notification_id and acknowledged_at is null;
end $$;
grant execute on function public.acknowledge_alert(uuid, text) to authenticated;

-- Lets the app supply the typed name and batch id for one transaction.
create or replace function public.set_edit_context(
  p_actor_name text, p_batch_id text default null
) returns void language sql security definer set search_path = public as $$
  select set_config('app.actor_name', coalesce(p_actor_name,''), true),
         set_config('app.batch_id',  coalesce(p_batch_id,''),  true);
$$;
grant execute on function public.set_edit_context(text, text) to authenticated;

-- ═════════ 6. RLS ═════════
-- CRM reads its own alerts. Nobody inserts or edits them from the browser.
drop policy if exists notifications_read_own_role on notifications;
create policy notifications_read_own_role on notifications
  for select to authenticated
  using (target_role = public.current_app_role());

-- ═════════ VERIFY ═════════
select
  (select count(*) from campaigns)      as campaigns_total_after,
  (select count(*) from notifications)  as notifications_total_after,
  (select count(*) from pg_trigger where tgrelid='campaigns'::regclass
     and tgname in ('campaigns_stamp_submission','campaigns_change_alerts'))
                                        as triggers_installed;
-- Expect both totals IDENTICAL to the check above, triggers_installed = 2.

-- ═════════ BEGIN ... ROLLBACK TEST ═════════
/*
begin;
  insert into campaigns (campaign_name, launch_date, is_crm_self,
                         content_status, content_submitted_at, header)
  values ('TEST_alert', current_date + 30, false, 'SUBMITTED', now(), 'Old header');

  -- A malformed alert must NOT wedge the edit. Break field_label on purpose:
  alter table notifications rename column field_label to field_label_broken;

  update campaigns set header = 'New header' where campaign_name = 'TEST_alert';
  -- EXPECT: UPDATE 1 — the edit SUCCEEDS despite the broken alert path.

  select action, description from activity_logs
   where action = 'ALERT_CAPTURE_FAILED' order by created_at desc limit 1;
  -- EXPECT: one row explaining the alert could not be created.

  alter table notifications rename column field_label_broken to field_label;
rollback;
*/

-- ═════════ ROLLBACK NOTE ═════════
--   drop trigger if exists campaigns_change_alerts   on campaigns;
--   drop trigger if exists campaigns_stamp_submission on campaigns;
--   drop function if exists public.capture_change_alerts();
--   drop function if exists public.stamp_submission();
--   drop function if exists public.acknowledge_alert(uuid, text);
--   drop function if exists public.set_edit_context(text, text);
--   drop function if exists public.field_label(text);
--   alter table campaigns drop column if exists category_submitted_at;
--   alter table campaigns drop column if exists content_submitted_at;
-- The added notifications columns can stay; they are nullable.

notify pgrst, 'reload schema';
