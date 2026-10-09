-- =====================================================================
-- CLiQ Push Ops — undo migrations 14-19, back to the 13 baseline
--
-- Run ONLY if you are reverting the app to the pre-14 build. Run the
-- sections IN THIS ORDER (reverse of how they were applied). Each section
-- is idempotent.
--
-- READ FIRST
-- No campaign data is deleted by this file. The archive tables from
-- migration 18 are KEPT by default, because they may be the only copy of
-- campaigns a reset removed. The final section drops them, commented out —
-- uncomment only when you are certain you no longer need them.
-- =====================================================================

-- ───────── 19: tracking pre-fill ─────────
-- Migration 19 only changed data (segment_2 pre-fill). There is nothing to
-- undo structurally. If you want the pre-filled values cleared:
-- update campaigns set segment_2 = null
--  where segment_2 in ('cat','int') and calendar_status <> 'UPDATED';

-- ───────── 18: upload reset ─────────
drop function if exists public.reset_campaigns_with_archive(jsonb, boolean);
drop function if exists public.upload_reset_preview();

-- ───────── 17: security hardening ─────────
-- a) the column-ownership trigger
drop trigger  if exists campaigns_column_ownership on campaigns;
drop function if exists public.enforce_column_ownership();

-- b) restore the permissive read policies the 13 baseline had
drop policy if exists campaigns_read on campaigns;
create policy campaigns_read on campaigns
  for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['crm_decisions','content_submissions','qc_checklists',
                           'change_requests','activity_logs']
  loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated using (true)', t);
  end loop;
end $$;

-- c) restore update_calendar() to the migration 09 version: qc_status only,
--    no tracking-code check and no conditional creative rule.
create or replace function public.update_calendar(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_qc qc_status;
begin
  if not public.is_crm() then raise exception 'Only CRM can update the calendar.'; end if;
  select qc_status into v_qc from campaigns where id = p_campaign_id;
  if v_qc is distinct from 'PASSED'::qc_status then
    raise exception 'Final QC must pass before this campaign can be added to the calendar.';
  end if;
  update campaigns
     set calendar_status = 'UPDATED', calendar_updated_at = now(),
         calendar_updated_by = auth.uid(), production_status = 'READY'::production_status
   where id = p_campaign_id;
end $$;
grant execute on function public.update_calendar(uuid) to authenticated;

-- ───────── 16: tracking short-code columns ─────────
-- Dropping these DESTROYS every short code CRM has chosen. Keeping them is
-- harmless to the old build, which simply ignores unknown columns — so they
-- are kept by default. Uncomment only if you truly want them gone.
-- alter table campaigns drop column if exists tracking_category;
-- alter table campaigns drop column if exists tracking_sub_category;
-- alter table campaigns drop column if exists tracking_brand;
-- alter table campaigns drop column if exists tracking_offer;
-- alter table campaigns drop column if exists tracking_landing;
-- alter table campaigns drop column if exists campaign_name_code;

-- ───────── 15: the DESIGN account and its policy ─────────
-- Restores the DESIGN write policy that migration 08 created.
drop policy if exists campaigns_design_write on campaigns;
create policy campaigns_design_write on campaigns
  for update to authenticated
  using (public.current_app_role() = 'DESIGN'::app_role)
  with check (public.current_app_role() = 'DESIGN'::app_role);

-- Un-ban the account and restore its profile row.
update auth.users set banned_until = null where email = 'design@internal.local';

insert into public.profiles (id, username, display_name, role)
select u.id, 'DESIGN', 'Design Team', 'DESIGN'::app_role
from auth.users u
where u.email = 'design@internal.local'
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ───────── 14: Design routing ─────────
-- Migration 14 only changed data (design_status). The old build reads
-- design_status again, so anything Content has submitted needs routing to
-- Design as it would have been before:
-- update campaigns set design_status = 'PENDING'
--  where content_status = 'SUBMITTED' and design_status = 'NOT_ASSIGNED'
--    and qc_status <> 'PASSED' and calendar_status <> 'UPDATED';

-- ───────── archive tables: LAST, and only when certain ─────────
-- drop table if exists campaigns_archive;
-- drop table if exists activity_logs_archive;
-- drop table if exists qc_checklists_archive;
-- drop table if exists crm_decisions_archive;
-- drop table if exists upload_reset_batches;

notify pgrst, 'reload schema';

-- VERIFY: the 18 functions should be gone, the trigger gone, reads open again.
select 'reset fn still present' as problem, proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and proname in ('reset_campaigns_with_archive','upload_reset_preview')
union all
select 'ownership trigger still present', tgname from pg_trigger
where tgrelid = 'public.campaigns'::regclass and tgname = 'campaigns_column_ownership';
-- Zero rows = rollback complete.
