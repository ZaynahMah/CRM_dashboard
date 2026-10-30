-- =====================================================================
-- Migration 36 — READ-ONLY PRE-CHECKS, and the ROLLBACK script.
-- Nothing in the PRE-CHECK section changes anything.
-- =====================================================================

-- ═════════ A. SNAPSHOT THE CURRENT STATE (read only) ═════════
select count(*) as campaigns_before from campaigns;
select count(*) as notifications_before from notifications;

-- A1. Policies, so you can compare afterwards.
select tablename, policyname, cmd,
       left(qual::text, 200)       as using_expr,
       left(with_check::text, 200) as with_check_expr
from pg_policies
where schemaname='public' and tablename in ('campaigns','notifications')
order by tablename, cmd, policyname;
-- BEFORE: campaigns_update (UPDATE, no with_check);
--         notif_read, notifications_read_own_role (SELECT);
--         notif_insert (INSERT); notif_update (UPDATE).
-- AFTER:  campaigns_update has BOTH using and with_check;
--         notifications_read_own_role is gone;
--         notif_insert gains the priority/type restriction.

-- A2. Grants on notifications, so the column-level change is comparable.
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema='public' and table_name='notifications'
  and grantee = 'authenticated'
order by privilege_type, column_name;
-- BEFORE: UPDATE on every column (table-level grant).
-- AFTER:  UPDATE on `is_read` ONLY. SELECT and INSERT unchanged.

-- A3. Anything already in the table that the new INSERT rule would forbid.
select priority, type, count(*)
from notifications
where coalesce(priority,'NORMAL') <> 'NORMAL' or type = 'INPUT_CHANGED'
group by priority, type;
-- Existing rows are NOT affected — a policy applies to new writes only.
-- This is just so you know what is there.

-- ═════════ B. WHAT THE APP WRITES TO notifications ═════════
-- Verified by reading the code; listed so you can confirm nothing breaks:
--   services/campaigns.ts  notify()          INSERT  priority defaults to
--                                            NORMAL, type is ASSIGNMENT /
--                                            REVIEW / QC / CHANGE_REQUEST
--                                            -> still allowed.
--   services/notifications.ts markRead()     UPDATE  is_read only -> allowed.
--   services/notifications.ts markAllRead()  UPDATE  is_read only -> allowed.
--   services/changeAlerts.ts openRedAlerts() SELECT  -> unchanged.
--   services/changeAlerts.ts acknowledgeAlert() -> RPC, not a table write.
-- NOTHING in the app inserts RED/AMBER or INPUT_CHANGED, and nothing
-- updates any column other than is_read. The send-back notification is
-- written by send_back_to_content() (SECURITY DEFINER), which bypasses RLS.

-- Confirm for yourself that no browser path needs more than is_read:
--   grep -rn 'from("notifications")' src/
-- Expect exactly: one select (changeAlerts), one select (notifications),
-- two updates setting is_read, one insert in campaigns.ts notify().

-- ═════════ C. ROLLBACK (only if you need to undo 36) ═════════
-- Restores the policies and grants exactly as they are today. Idempotent.
-- No PN data is touched either way.
/*
begin;

  -- C1. campaigns_update, back to the pre-36 definition.
  drop policy if exists campaigns_update on campaigns;
  create policy campaigns_update on campaigns
    for update to authenticated
    using (
      public.is_crm()
      or (public.current_app_role() = 'CATEGORY'::app_role
          and category_status in ('EMPTY','DRAFT'))
      or (public.current_app_role() = 'CONTENT'::app_role
          and content_status in ('NOT_ASSIGNED','PENDING','NEEDS_CHANGES'))
    );

  -- C2. notifications policies, back to the pre-36 definitions.
  drop policy if exists notif_insert on notifications;
  create policy notif_insert on notifications
    for insert to authenticated
    with check (public.current_app_role() <> 'EXECUTIVE'::app_role);

  drop policy if exists notif_update on notifications;
  create policy notif_update on notifications
    for update to authenticated
    using (user_id = auth.uid() or target_role = public.current_app_role());

  -- notifications_read_own_role was redundant with notif_read; recreate it
  -- only if you want the exact prior list.
  drop policy if exists notifications_read_own_role on notifications;
  create policy notifications_read_own_role on notifications
    for select to authenticated
    using (target_role = public.current_app_role());

  -- C3. Table-level UPDATE grant, undoing the column restriction.
  grant update on notifications to authenticated;

  -- C4. The triggers and helpers 36 added.
  drop trigger if exists campaigns_no_status_regression on campaigns;
  drop function if exists public.forbid_status_regression();
  drop function if exists public.check_trigger_enum_literals();
  -- Re-run migration 35 to restore its (broken) capture trigger, or
  -- migration 33 to restore the prior enforce_column_ownership().

commit;
*/

-- ═════════ D. AFTER RUNNING 36 ═════════
select count(*) as campaigns_after from campaigns;
select count(*) as notifications_after from notifications;
-- Both must equal the "before" numbers from section A.
select * from public.check_trigger_enum_literals();   -- expect zero rows
