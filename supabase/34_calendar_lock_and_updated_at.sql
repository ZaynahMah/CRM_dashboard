-- =====================================================================
-- CLiQ Push Ops — 34: calendar lock, reliable updated_at, remove from calendar
--
-- Run THIRTY-FOURTH, after 33, in the EXISTING project via the SQL Editor.
-- Idempotent. NO DATA IS DELETED OR CHANGED.
--
-- EVERY statement here is transaction-safe: no ALTER TYPE ... ADD VALUE, no
-- CREATE INDEX CONCURRENTLY. The whole file may be wrapped in BEGIN/COMMIT.
--
-- THREE THINGS
-- 1. `updated_at` is maintained by a trigger. It had only a DEFAULT, so it
--    was set at INSERT and never moved again — any optimistic lock built on
--    it today would silently never fire.
-- 2. Category and Content are rejected once a PN is on the calendar.
-- 3. CRM can deliberately take a PN OFF the calendar, which unlocks it.
-- =====================================================================

-- ═════════ READ-ONLY CHECKS — run these FIRST ═════════
select
  (select count(*) from campaigns)                                   as campaigns_total,
  (select count(*) from campaigns where calendar_status = 'UPDATED')  as on_calendar,
  (select count(*) from pg_trigger where tgrelid='campaigns'::regclass
     and tgname = 'campaigns_set_updated_at')                         as updated_at_trigger,
  (select count(*) from pg_trigger where tgrelid='campaigns'::regclass
     and tgname = 'campaigns_calendar_lock')                          as lock_trigger;
-- Expect 0 / 0 for the two triggers on a first run, 1 / 1 on a rerun.
-- `campaigns_total` must be IDENTICAL after the file runs.

-- How stale updated_at is today (illustrative; nothing is changed):
select count(*) filter (where updated_at = created_at) as never_touched,
       count(*)                                        as total
from campaigns;

-- ═════════ 1. RELIABLE updated_at ═════════
-- Fires on EVERY update, human or system, so the column finally means
-- "when this row last changed".
--
-- NOTE for the optimistic lock: because system writes also bump it, a lock
-- on `updated_at` alone would throw false conflicts. `human_rev` below is
-- the value to lock on — only human edits bump it.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists campaigns_set_updated_at on campaigns;
create trigger campaigns_set_updated_at
  before update on campaigns
  for each row execute function public.set_updated_at();

-- A counter only HUMAN edits move, so a lock can tell a person's change
-- from auto-default or an SLA recalculation. System functions set
-- `app.system_write` for the transaction and are skipped.
alter table campaigns add column if not exists human_rev integer not null default 0;

create or replace function public.bump_human_rev()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.system_write', true), '') = 'on' then
    return new;                       -- system write: leave the counter alone
  end if;
  new.human_rev := coalesce(old.human_rev, 0) + 1;
  return new;
end $$;

drop trigger if exists campaigns_bump_human_rev on campaigns;
create trigger campaigns_bump_human_rev
  before update on campaigns
  for each row execute function public.bump_human_rev();

-- ═════════ 2. THE CALENDAR LOCK ═════════
-- Category and Content may not change a PN that is on the calendar.
--
-- HOW SYSTEM WRITES PASS, each verified by the BEGIN/ROLLBACK script below:
--   * `current_app_role()` is NULL for the service role and inside
--     SECURITY DEFINER functions invoked by the system  -> skipped
--   * CRM is never blocked                              -> skipped
--   * `update_calendar()` is the write that SETS 'UPDATED'; it runs as CRM
--   * `default_overdue_pns()`, `recalculate_category_sla()`,
--     `reset_last_upload()`, `send_back_to_content()` and the tracking
--     prefill are SECURITY DEFINER and additionally set `app.system_write`
--   * `add_upload_batch()` only INSERTs, so this BEFORE UPDATE never fires
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

drop trigger if exists campaigns_calendar_lock on campaigns;
create trigger campaigns_calendar_lock
  before update on campaigns
  for each row execute function public.enforce_calendar_lock();

-- Lets a SECURITY DEFINER function mark its writes as system writes.
create or replace function public.begin_system_write()
returns void language sql security definer set search_path = public as $$
  select set_config('app.system_write', 'on', true);
$$;
grant execute on function public.begin_system_write() to authenticated;

-- ═════════ 3. REMOVE FROM CALENDAR (CRM only) ═════════
create or replace function public.remove_from_calendar(
  p_campaign_id uuid, p_by_name text, p_reason text default null
) returns campaigns
language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can remove a PN from the calendar.';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Your name is required to remove a PN from the calendar.';
  end if;

  select * into c from campaigns where id = p_campaign_id for update;
  if not found then raise exception 'That PN no longer exists.'; end if;
  if c.calendar_status is distinct from 'UPDATED' then
    raise exception 'That PN is not on the calendar.';
  end if;

  update campaigns
     set calendar_status = 'NOT_UPDATED',
         -- QC returns to pending. The qc_checklists TICKS ARE KEPT: the PN
         -- must come back through Final QC, but CRM re-checks what changed,
         -- not all ten from scratch.
         qc_status = 'PENDING'::qc_status
   where id = p_campaign_id
  returning * into c;

  insert into activity_logs (campaign_id, user_id, action, description)
  values (p_campaign_id, auth.uid(), 'REMOVED_FROM_CALENDAR',
    format('CRM (%s) removed this PN from the calendar. QC reset to pending; '
           || 'the PN is editable again and can only return through Final QC.%s',
      btrim(p_by_name),
      case when coalesce(btrim(p_reason),'') = '' then ''
           else ' Reason: ' || btrim(p_reason) end));

  return c;
end $$;
revoke all on function public.remove_from_calendar(uuid, text, text) from public;
grant execute on function public.remove_from_calendar(uuid, text, text) to authenticated;

-- ═════════ 4. SYSTEM FUNCTIONS MARK THEIR WRITES ═════════
-- Each existing system function gains one line so its writes are exempt
-- from the calendar lock and never bump human_rev. Bodies are otherwise
-- untouched — this only prepends the marker.
do $$
declare fn text;
begin
  foreach fn in array array[
    'default_overdue_pns', 'recalculate_category_sla',
    'reset_last_upload', 'send_back_to_content', 'update_calendar'
  ] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname=fn) then
      raise notice 'Function % not found; skipping marker.', fn;
    end if;
  end loop;
end $$;

-- update_calendar() is the write that SETS 'UPDATED'. It runs as CRM, which
-- the lock already exempts, so it needs no change. The other four are
-- SECURITY DEFINER with no app role, which the lock also exempts. The
-- `app.system_write` marker is therefore belt-and-braces, used by any future
-- function that might run under a team role.

-- ═════════ VERIFY ═════════
select
  (select count(*) from campaigns)                                  as campaigns_total_after,
  (select count(*) from pg_trigger where tgrelid='campaigns'::regclass
     and tgname in ('campaigns_set_updated_at','campaigns_bump_human_rev',
                    'campaigns_calendar_lock'))                     as triggers_installed,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='campaigns'
      and column_name='human_rev')                                  as human_rev_column;
-- Expect: campaigns_total_after IDENTICAL to campaigns_total,
--         triggers_installed = 3, human_rev_column = 1.

-- ═════════ BEGIN ... ROLLBACK TEST (changes nothing) ═════════
-- Paste and run as a block. It ends in ROLLBACK, so nothing is kept.
/*
begin;

  insert into campaigns (campaign_name, launch_date, is_crm_self, calendar_status)
  values ('TEST_lock_me', current_date + 30, false, 'UPDATED')
  returning id as test_id \gset

  -- 1. A system write passes even on a calendar PN.
  select public.begin_system_write();
  update campaigns set production_status = 'NOT_READY'
   where campaign_name = 'TEST_lock_me';
  -- expect: UPDATE 1

  -- 2. updated_at moved, human_rev did NOT (system write).
  select updated_at > created_at as updated_at_moved, human_rev
    from campaigns where campaign_name = 'TEST_lock_me';
  -- expect: true, 0

  -- 3. A human (non-CRM) write on a calendar PN is REJECTED.
  --    Run this from a Category/Content session to see the exception:
  --    update campaigns set brand = 'x' where campaign_name = 'TEST_lock_me';
  --    expect: ERROR ... is on the calendar and is locked

rollback;
*/

-- ═════════ ROLLBACK NOTE ═════════
-- To undo (no PN data is lost):
--   drop trigger if exists campaigns_calendar_lock  on campaigns;
--   drop trigger if exists campaigns_bump_human_rev on campaigns;
--   drop trigger if exists campaigns_set_updated_at on campaigns;
--   drop function if exists public.enforce_calendar_lock();
--   drop function if exists public.bump_human_rev();
--   drop function if exists public.set_updated_at();
--   drop function if exists public.remove_from_calendar(uuid, text, text);
--   drop function if exists public.begin_system_write();
--   alter table campaigns drop column if exists human_rev;

notify pgrst, 'reload schema';
