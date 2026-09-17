-- =====================================================================
-- CLiQ Push Ops — Explicit calendar finalization + status synchronization
-- Run NINTH. Adds the "Update Calendar" gate that Final View/Calendar now
-- require, and makes workflow_status (added in 06, never kept in sync)
-- an always-accurate mirror of the real status columns via trigger,
-- rather than leaving two status models that can silently disagree.
-- =====================================================================

-- ---------- the explicit finalization gate ----------
-- A campaign can pass Final QC and still not be in Final View/Calendar
-- until CRM explicitly clicks "Update Calendar". This is the one flag
-- both Final View and the Calendar page read — they are the same list.
alter table campaigns add column if not exists calendar_status text not null default 'NOT_UPDATED'
  check (calendar_status in ('NOT_UPDATED','UPDATED'));
alter table campaigns add column if not exists calendar_updated_at timestamptz;
alter table campaigns add column if not exists calendar_updated_by uuid references profiles(id);

create index if not exists campaigns_calendar_status_idx on campaigns(calendar_status);

-- ---------- controlled RPC: only reachable once QC has actually passed ----------
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
     set calendar_status = 'UPDATED'::text,
         calendar_updated_at = now(),
         calendar_updated_by = auth.uid(),
         production_status = 'READY'::production_status
   where id = p_campaign_id;
end $$;
grant execute on function public.update_calendar(uuid) to authenticated;

-- ---------- workflow_status: one authoritative derivation, always in sync ----------
-- workflow_status (added in 06) was only ever backfilled once and nothing
-- in the app reads it, which is exactly the "two status models that can
-- silently disagree" risk. Rather than rip it out, this trigger makes it a
-- guaranteed-accurate mirror of the five real status columns plus the new
-- calendar gate, computed the same way on every write — so if anything
-- (a report, a future page, an external query) ever reads workflow_status,
-- it can never contradict the columns the UI actually uses.
create or replace function public.sync_workflow_status()
returns trigger language plpgsql as $$
begin
  new.workflow_status := case
    when new.calendar_status = 'UPDATED'                         then 'PUBLISHED'
    when new.qc_status = 'PASSED'                                then 'READY_TO_PUBLISH'
    when new.is_emergency and new.emergency_status = 'PENDING'    then 'URGENT_PENDING_CRM'
    when new.content_status = 'SUBMITTED' or new.design_status = 'SUBMITTED' then 'CRM_QC'
    when new.crm_status = 'SENT_TO_CONTENT'                       then 'CONTENT_CREATIVE'
    when new.crm_status = 'IN_PLANNING'                           then 'CRM_COMPLETED'
    when new.crm_status = 'AWAITING_REVIEW'                       then 'CRM_REVIEW'
    when new.category_status = 'LOCKED'                           then 'CATEGORY_SUBMITTED'
    when new.category_status = 'DRAFT'                            then 'CATEGORY_IN_PROGRESS'
    when new.crm_status <> 'NOT_STARTED'                          then 'CATEGORY_PENDING'
    else 'CRM_INPUT'
  end;
  return new;
end $$;

drop trigger if exists campaigns_sync_workflow_status on campaigns;
create trigger campaigns_sync_workflow_status
  before insert or update on campaigns
  for each row execute function public.sync_workflow_status();

-- Re-run once so existing rows reflect the real trigger logic rather than the
-- one-time backfill UPDATE from migration 06.
update campaigns set updated_at = updated_at;

select calendar_status, count(*) from campaigns group by 1;
