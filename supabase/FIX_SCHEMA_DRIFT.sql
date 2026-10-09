-- =====================================================================
-- CLiQ Push Ops — Consolidated schema repair
--
-- Run VERIFY_SCHEMA.sql first. This script is the single, safe-to-run-
-- anytime consolidation of every column/type/function added across
-- migrations 04 through 10. Every statement uses IF NOT EXISTS /
-- CREATE OR REPLACE, so running this on a database that already has some
-- or all of these changes does nothing destructive — it only adds what's
-- actually missing. This exists because the schema grew across 10
-- separate migration files over many sessions, which is exactly the kind
-- of thing that's easy to apply out of order or skip one of by hand.
--
-- After running this, you MUST reload PostgREST's schema cache or the
-- API will keep returning PGRST204 for columns that now genuinely exist:
--   Supabase Dashboard -> Settings -> API -> "Reload schema cache"
--   or run: NOTIFY pgrst, 'reload schema';
-- =====================================================================

-- ---------- enums (safe no-ops if they already exist) ----------
do $$ begin create type app_role as enum ('CATEGORY','CRM','CONTENT','EXECUTIVE'); exception when duplicate_object then null; end $$;
do $$ begin alter type app_role add value if not exists 'DESIGN'; exception when duplicate_object then null; end $$;
do $$ begin create type campaign_origin as enum ('CATEGORY_REQUEST','CRM_PLANNED'); exception when duplicate_object then null; end $$;
do $$ begin create type category_status as enum ('EMPTY','DRAFT','SUBMITTED','LOCKED'); exception when duplicate_object then null; end $$;
do $$ begin create type crm_status as enum ('NOT_STARTED','AWAITING_REVIEW','IN_PLANNING','SENT_TO_CONTENT','FINAL_QC','READY'); exception when duplicate_object then null; end $$;
do $$ begin create type content_status as enum ('NOT_ASSIGNED','PENDING','SUBMITTED','NEEDS_CHANGES'); exception when duplicate_object then null; end $$;
do $$ begin create type qc_status as enum ('PENDING','IN_PROGRESS','PASSED'); exception when duplicate_object then null; end $$;
do $$ begin create type production_status as enum ('NOT_READY','READY','PUSHED','BLOCKED'); exception when duplicate_object then null; end $$;
do $$ begin create type priority_level as enum ('LOW','NORMAL','HIGH','CRITICAL'); exception when duplicate_object then null; end $$;
do $$ begin create type change_status as enum ('PENDING','APPROVED','REJECTED'); exception when duplicate_object then null; end $$;
do $$ begin create type push_channel as enum ('PN','WHATSAPP','EMAIL','SMS','APP_INBOX','WEB_PUSH'); exception when duplicate_object then null; end $$;

-- ---------- every column ever added to campaigns, consolidated ----------
alter table campaigns add column if not exists channel push_channel not null default 'PN';
alter table campaigns add column if not exists segment_id uuid;
alter table campaigns add column if not exists segment_2_id uuid;
alter table campaigns add column if not exists push_tag text;
alter table campaigns add column if not exists group_id text;
alter table campaigns add column if not exists collapse_id text;
alter table campaigns add column if not exists global_limit boolean not null default true;
alter table campaigns add column if not exists sound boolean not null default false;
alter table campaigns add column if not exists pn_template text;
alter table campaigns add column if not exists access_type text;
alter table campaigns add column if not exists offer_construct text;
alter table campaigns add column if not exists expected_reach bigint;

alter table campaigns add column if not exists pncc_segment_label text;
alter table campaigns add column if not exists pncc_segment_name text;
alter table campaigns add column if not exists pncc_category_code text;
alter table campaigns add column if not exists slot_type text not null default 'STANDARD';
alter table campaigns add column if not exists date_time_brief text;
alter table campaigns add column if not exists expected_cvr text;
alter table campaigns add column if not exists expected_rpv text;
alter table campaigns add column if not exists creative_requirements text;
alter table campaigns add column if not exists creative_link text;

alter table campaigns add column if not exists workflow_status text not null default 'CRM_INPUT';
alter table campaigns add column if not exists is_urgent boolean not null default false;
alter table campaigns add column if not exists urgent_reason text;
alter table campaigns add column if not exists title_brief text;
alter table campaigns add column if not exists message_brief text;
alter table campaigns add column if not exists header text;
alter table campaigns add column if not exists sub_copy_text text;
alter table campaigns add column if not exists h_count int;
alter table campaigns add column if not exists s_count int;
alter table campaigns add column if not exists collapse text;
alter table campaigns add column if not exists ops_details text;
alter table campaigns add column if not exists channel_name text;
alter table campaigns add column if not exists channel_format text;
alter table campaigns add column if not exists keywords text;
alter table campaigns add column if not exists landing_plus_tracking text;
alter table campaigns add column if not exists tracking_code_check text;
alter table campaigns add column if not exists feedback_1 text;
alter table campaigns add column if not exists feedback_2 text;
alter table campaigns add column if not exists date_ddmmyy text;

-- this is the column the reported error was missing:
alter table campaigns add column if not exists design_status text not null default 'NOT_ASSIGNED';
do $$ begin
  alter table campaigns add constraint campaigns_design_status_check
    check (design_status in ('NOT_ASSIGNED','PENDING','SUBMITTED'));
exception when duplicate_object then null; end $$;

alter table campaigns add column if not exists emergency_status text not null default 'PENDING';
do $$ begin
  alter table campaigns add constraint campaigns_emergency_status_check
    check (emergency_status in ('PENDING','ACCEPTED','REJECTED'));
exception when duplicate_object then null; end $$;
alter table campaigns add column if not exists emergency_rejection_reason text;
alter table campaigns add column if not exists is_crm_self boolean not null default false;

alter table campaigns add column if not exists calendar_status text not null default 'NOT_UPDATED';
do $$ begin
  alter table campaigns add constraint campaigns_calendar_status_check
    check (calendar_status in ('NOT_UPDATED','UPDATED'));
exception when duplicate_object then null; end $$;
alter table campaigns add column if not exists calendar_updated_at timestamptz;
alter table campaigns add column if not exists calendar_updated_by uuid references profiles(id);

alter table campaigns add column if not exists slot_number integer;

-- ---------- indexes ----------
create index if not exists campaigns_calendar_status_idx on campaigns(calendar_status);

-- DELIBERATELY NOT creating a uniqueness constraint on (launch_date,
-- launch_time, slot_number) here. That was proposed in 10_slot_dedup.sql
-- based on an assumption that has since been directly contradicted: real
-- CRM Input files legitimately have multiple rows sharing the same Day +
-- Time + Slot (differing by Segment/Category). Applying that constraint
-- now would cause every future upload to fail with a unique-violation the
-- same way this whole investigation started with a missing column. Do
-- NOT create this index until the correct natural key is confirmed
-- against a real sample of the repeated-slot rows.

-- ---------- functions/triggers that depend on the above columns ----------
create or replace function public.current_app_role()
returns app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_crm()
returns boolean language sql stable as $$ select public.current_app_role() = 'CRM'::app_role $$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  uname := upper(split_part(new.email, '@', 1));
  if uname not in ('CATEGORY','CRM','CONTENT','EXECUTIVE','DESIGN') then
    return new;
  end if;
  insert into public.profiles (id, username, display_name, role)
  values (new.id, uname, initcap(uname) || ' Team', uname::app_role)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.accept_emergency(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crm() then raise exception 'Only CRM can accept an emergency push.'; end if;
  update campaigns
     set emergency_status = 'ACCEPTED'::text,
         crm_status = 'AWAITING_REVIEW'::crm_status
   where id = p_campaign_id;
end $$;
grant execute on function public.accept_emergency(uuid) to authenticated;

create or replace function public.reject_emergency(p_campaign_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crm() then raise exception 'Only CRM can reject an emergency push.'; end if;
  update campaigns
     set emergency_status = 'REJECTED'::text,
         emergency_rejection_reason = p_reason,
         production_status = 'BLOCKED'::production_status
   where id = p_campaign_id;
end $$;
grant execute on function public.reject_emergency(uuid, text) to authenticated;

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

-- ---------- the three original workflow RPCs from 02_rls.sql, re-verified ----------
-- These were NOT in the previous version of this script — an audit gap.
-- If 02_rls.sql had any drift at all, Category submission, Content
-- submission, or change-request approval would fail exactly like
-- design_status did, and nothing above would have caught it.
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
grant execute on function public.submit_category(uuid) to authenticated;

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
grant execute on function public.submit_content(uuid) to authenticated;

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
grant execute on function public.apply_change_request(uuid) to authenticated;

-- ---------- RLS: make sure every role's policy actually exists ----------
alter table campaigns enable row level security;

drop policy if exists campaigns_design_write on campaigns;
create policy campaigns_design_write on campaigns for update to authenticated
  using (public.current_app_role()::text = 'DESIGN')
  with check (public.current_app_role()::text = 'DESIGN');
-- Compared as text, not cast to app_role. This is deliberate: 'DESIGN' was
-- just added to app_role by ADD VALUE earlier in THIS SAME script, and
-- Postgres forbids using a brand-new enum value in an expression within the
-- same transaction that added it ("unsafe use of new value of enum type").
-- Supabase's SQL Editor runs a pasted multi-statement script as one
-- transaction, so the earlier version of this script — which did
-- `= 'DESIGN'::app_role` here — was hitting exactly that error on every
-- run, aborting and rolling back EVERYTHING in the script, including the
-- design_status column addition earlier in the same file. That is almost
-- certainly why re-running the "fix" produced the identical PGRST204 error
-- with zero rows changed: nothing had ever actually committed.

-- ---------- force PostgREST to see everything above immediately ----------
notify pgrst, 'reload schema';

-- Re-run the diagnostic to confirm zero missing columns remain.
select count(*) as still_missing_columns from (
  select unnest(array[
    'design_status','emergency_status','calendar_status','slot_number','is_crm_self',
    'title_brief','message_brief','header','sub_copy_text','feedback_1','feedback_2'
  ]) as col
) expected
where expected.col not in (
  select column_name from information_schema.columns
  where table_name = 'campaigns' and table_schema = 'public'
);
-- Should return 0.

select count(*) as still_missing_functions from (
  select unnest(array[
    'submit_category','submit_content','apply_change_request',
    'accept_emergency','reject_emergency','update_calendar'
  ]) as fn
) expected
where expected.fn not in (
  select routine_name from information_schema.routines
  where routine_schema = 'public' and routine_type = 'FUNCTION'
);
-- Should also return 0. If either query returns > 0, something in this
-- script did not apply — paste the exact error before re-running.
