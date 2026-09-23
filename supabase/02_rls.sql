-- =====================================================================
-- CLiQ Push Operations - Row Level Security
-- Run this SECOND. Permissions live in the database, not just the UI.
-- =====================================================================

-- Role lookup. SECURITY DEFINER so policies on profiles do not recurse.
create or replace function public.current_app_role()
returns app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_crm()
returns boolean language sql stable as $$ select public.current_app_role() = 'CRM'::app_role $$;

alter table profiles            enable row level security;
alter table calendar_days       enable row level security;
alter table calendar_slots      enable row level security;
alter table campaigns           enable row level security;
alter table crm_decisions       enable row level security;
alter table content_submissions enable row level security;
alter table qc_checklists       enable row level security;
alter table change_requests     enable row level security;
alter table activity_logs       enable row level security;
alter table notifications       enable row level security;

-- ---------- profiles ----------
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (true);

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- calendar: everyone reads, only CRM writes (RULE 1) ----------
drop policy if exists days_read on calendar_days;
create policy days_read on calendar_days for select to authenticated using (true);
drop policy if exists days_crm_write on calendar_days;
create policy days_crm_write on calendar_days for all to authenticated
  using (public.is_crm()) with check (public.is_crm());

drop policy if exists slots_read on calendar_slots;
create policy slots_read on calendar_slots for select to authenticated using (true);
drop policy if exists slots_crm_write on calendar_slots;
create policy slots_crm_write on calendar_slots for all to authenticated
  using (public.is_crm()) with check (public.is_crm());

-- ---------- campaigns ----------
drop policy if exists campaigns_read on campaigns;
create policy campaigns_read on campaigns for select to authenticated using (true);

-- Category may only create Category-requested campaigns. CRM may create anything.
drop policy if exists campaigns_insert on campaigns;
create policy campaigns_insert on campaigns for insert to authenticated
  with check (
    public.is_crm()
    or (public.current_app_role() = 'CATEGORY'::app_role
        and campaign_origin = 'CATEGORY_REQUEST'::campaign_origin)
  );

-- CRM may update anything. Category may only update its own campaign while
-- the submission is still open - this is what RULE 7 (locking) enforces.
--
-- SUPERSEDED by 12_fix_category_content_update_rls.sql: the ownership
-- check below (created_by = auth.uid()) assumed Category creates its own
-- rows, which stopped being true once CRM's bulk upload became the only
-- way rows get created. 12_*.sql replaces this policy with a
-- status-based check and adds the missing CONTENT branch. Left here
-- unchanged for historical accuracy — running this file alone reproduces
-- the bug; always run 12 after it.
drop policy if exists campaigns_update on campaigns;
create policy campaigns_update on campaigns for update to authenticated
  using (
    public.is_crm()
    or (public.current_app_role() = 'CATEGORY'::app_role
        and created_by = auth.uid()
        and category_status in ('EMPTY'::category_status,'DRAFT'::category_status))
  )
  with check (
    public.is_crm()
    or public.current_app_role() = 'CATEGORY'::app_role
  );

drop policy if exists campaigns_delete on campaigns;
create policy campaigns_delete on campaigns for delete to authenticated using (public.is_crm());

-- ---------- crm decisions: CRM only ----------
drop policy if exists decisions_read on crm_decisions;
create policy decisions_read on crm_decisions for select to authenticated using (true);
drop policy if exists decisions_write on crm_decisions;
create policy decisions_write on crm_decisions for all to authenticated
  using (public.is_crm()) with check (public.is_crm());

-- ---------- content ----------
drop policy if exists content_read on content_submissions;
create policy content_read on content_submissions for select to authenticated using (true);
drop policy if exists content_write on content_submissions;
create policy content_write on content_submissions for all to authenticated
  using (public.current_app_role() in ('CONTENT'::app_role,'CRM'::app_role))
  with check (public.current_app_role() in ('CONTENT'::app_role,'CRM'::app_role));

-- ---------- qc: CRM only ----------
drop policy if exists qc_read on qc_checklists;
create policy qc_read on qc_checklists for select to authenticated using (true);
drop policy if exists qc_write on qc_checklists;
create policy qc_write on qc_checklists for all to authenticated
  using (public.is_crm()) with check (public.is_crm());

-- ---------- change requests ----------
drop policy if exists cr_read on change_requests;
create policy cr_read on change_requests for select to authenticated using (true);
drop policy if exists cr_insert on change_requests;
create policy cr_insert on change_requests for insert to authenticated
  with check (public.current_app_role() in ('CATEGORY'::app_role,'CONTENT'::app_role,'CRM'::app_role));
drop policy if exists cr_update on change_requests;
create policy cr_update on change_requests for update to authenticated
  using (public.is_crm()) with check (public.is_crm());

-- ---------- audit trail: append only, everyone can read ----------
drop policy if exists logs_read on activity_logs;
create policy logs_read on activity_logs for select to authenticated using (true);
drop policy if exists logs_insert on activity_logs;
create policy logs_insert on activity_logs for insert to authenticated
  with check (public.current_app_role() <> 'EXECUTIVE'::app_role);

-- ---------- notifications ----------
drop policy if exists notif_read on notifications;
create policy notif_read on notifications for select to authenticated
  using (user_id = auth.uid() or target_role = public.current_app_role());
drop policy if exists notif_insert on notifications;
create policy notif_insert on notifications for insert to authenticated
  with check (public.current_app_role() <> 'EXECUTIVE'::app_role);
drop policy if exists notif_update on notifications;
create policy notif_update on notifications for update to authenticated
  using (user_id = auth.uid() or target_role = public.current_app_role())
  with check (true);

-- =====================================================================
-- Controlled workflow functions.
-- These exist so Content and Category can advance the workflow without
-- being granted broad UPDATE rights on campaigns (RULE 53: no silent edits).
-- =====================================================================

-- Content submits copy and flips only content_status.
create or replace function public.submit_content(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_app_role() not in ('CONTENT','CRM') then
    raise exception 'Only Content or CRM can submit creative.';
  end if;
  update campaigns
     set content_status = 'SUBMITTED'::content_status,
         crm_status     = 'FINAL_QC'::crm_status,
         qc_status      = 'IN_PROGRESS'::qc_status
   where id = p_campaign_id;
end $$;

-- Category submits and locks its own block.
create or replace function public.submit_category(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_app_role() not in ('CATEGORY','CRM') then
    raise exception 'Only Category or CRM can submit category details.';
  end if;
  update campaigns
     set category_status = 'LOCKED'::category_status,
         crm_status      = 'AWAITING_REVIEW'::crm_status,
         submitted_at    = now()
   where id = p_campaign_id;
end $$;

-- Applying an approved change request, restricted to a whitelist of columns.
create or replace function public.apply_change_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; allowed text[] := array[
  'campaign_name','category','sub_category','brand','offer','offer_details',
  'campaign_type','brief','product_collection','business_objective',
  'landing','reference_link','additional_notes'];
begin
  if not public.is_crm() then
    raise exception 'Only CRM can approve change requests.';
  end if;
  select * into r from change_requests where id = p_request_id;
  if r is null then raise exception 'Change request not found.'; end if;
  if not (r.field_name = any(allowed)) then
    raise exception 'Field % cannot be changed through a change request.', r.field_name;
  end if;
  execute format('update campaigns set %I = $1 where id = $2', r.field_name)
    using r.requested_value, r.campaign_id;
  update change_requests
     set status = 'APPROVED'::change_status, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_request_id;
end $$;

grant execute on function public.submit_content(uuid)       to authenticated;
grant execute on function public.submit_category(uuid)      to authenticated;
grant execute on function public.apply_change_request(uuid) to authenticated;
