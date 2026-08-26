-- =====================================================================
-- CLiQ Push Operations - Schema
-- Run this FIRST in Supabase -> SQL Editor.
-- Model: calendar_days -> calendar_slots -> campaigns -> workflow + audit
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type app_role as enum ('CATEGORY','CRM','CONTENT','EXECUTIVE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type campaign_origin as enum ('CATEGORY_REQUEST','CRM_PLANNED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type slot_status as enum ('AVAILABLE','ASSIGNED','BLOCKED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type category_status as enum ('EMPTY','DRAFT','SUBMITTED','LOCKED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type crm_status as enum ('NOT_STARTED','AWAITING_REVIEW','IN_PLANNING','SENT_TO_CONTENT','FINAL_QC','READY');
exception when duplicate_object then null; end $$;
do $$ begin
  create type content_status as enum ('NOT_ASSIGNED','PENDING','SUBMITTED','NEEDS_CHANGES');
exception when duplicate_object then null; end $$;
do $$ begin
  create type qc_status as enum ('PENDING','IN_PROGRESS','PASSED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type production_status as enum ('NOT_READY','READY','PUSHED','BLOCKED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type priority_level as enum ('LOW','NORMAL','HIGH','CRITICAL');
exception when duplicate_object then null; end $$;
do $$ begin
  create type change_status as enum ('PENDING','APPROVED','REJECTED');
exception when duplicate_object then null; end $$;

-- ---------- profiles ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  role app_role not null,
  created_at timestamptz not null default now()
);

-- Auto-create a profile whenever an auth user is created.
-- Role is derived from the email prefix: category@internal.local -> CATEGORY
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  uname := upper(split_part(new.email, '@', 1));
  if uname not in ('CATEGORY','CRM','CONTENT','EXECUTIVE') then
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

-- ---------- calendar ----------
create table if not exists calendar_days (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  month int not null,
  year int not null,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists calendar_slots (
  id uuid primary key default gen_random_uuid(),
  calendar_day_id uuid not null references calendar_days(id) on delete cascade,
  slot_number int not null,
  slot_time time not null,
  status slot_status not null default 'AVAILABLE',
  capacity int not null default 1,
  channel text not null default 'PUSH',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_day_id, slot_number)
);

-- ---------- campaigns ----------
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_name text not null,
  campaign_origin campaign_origin not null,

  category text,
  sub_category text,
  brand text,
  offer text,
  offer_details text,
  campaign_type text,
  brief text,
  product_collection text,
  business_objective text,
  landing text,
  reference_link text,
  additional_notes text,

  calendar_slot_id uuid unique references calendar_slots(id) on delete set null,
  launch_date date not null,
  launch_time time,
  priority priority_level not null default 'NORMAL',

  audience text,
  segment_1 text,
  segment_2 text,
  cohort text,
  campaign_id_ext text,
  cid text,
  tracking_code text,

  category_status category_status not null default 'EMPTY',
  crm_status crm_status not null default 'NOT_STARTED',
  content_status content_status not null default 'NOT_ASSIGNED',
  qc_status qc_status not null default 'PENDING',
  production_status production_status not null default 'NOT_READY',

  is_emergency boolean not null default false,
  emergency_reason text,
  business_deadline date,
  emergency_score int,

  -- RULE 4: category deadline is always launch date minus 7 days
  category_deadline date generated always as (launch_date - 7) stored,

  submitted_at timestamptz,
  created_by uuid references profiles(id),
  assigned_to uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaigns_launch_date_idx on campaigns(launch_date);
create index if not exists campaigns_origin_idx on campaigns(campaign_origin);
create index if not exists campaigns_deadline_idx on campaigns(category_deadline);

-- ---------- crm decisions ----------
create table if not exists crm_decisions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  recommended_date date,
  recommended_time time,
  recommended_audience text,
  recommended_cohort text,
  confidence numeric(4,3),
  recommendation_reason text,
  selected_date date,
  selected_time time,
  selected_audience text,
  selected_cohort text,
  is_manual_override boolean not null default false,
  override_reason text,
  crm_notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_decisions_campaign_idx on crm_decisions(campaign_id);

-- ---------- content ----------
create table if not exists content_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  header text,
  sub_copy text,
  cta text,
  pn_copy text,
  creative_asset_url text,
  creative_notes text,
  header_character_count int generated always as (coalesce(char_length(header),0)) stored,
  sub_copy_character_count int generated always as (coalesce(char_length(sub_copy),0)) stored,
  status content_status not null default 'PENDING',
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists content_campaign_idx on content_submissions(campaign_id);

-- ---------- qc ----------
create table if not exists qc_checklists (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references campaigns(id) on delete cascade,
  category_verified boolean not null default false,
  brand_verified boolean not null default false,
  offer_verified boolean not null default false,
  landing_verified boolean not null default false,
  date_verified boolean not null default false,
  time_verified boolean not null default false,
  audience_verified boolean not null default false,
  creative_verified boolean not null default false,
  copy_verified boolean not null default false,
  tracking_verified boolean not null default false,
  completed_by uuid references profiles(id),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- change requests ----------
create table if not exists change_requests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  requested_by uuid references profiles(id),
  field_name text not null,
  current_value text,
  requested_value text,
  reason text,
  status change_status not null default 'PENDING',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- audit + notifications ----------
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  user_id uuid references profiles(id),
  action text not null,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_campaign_idx on activity_logs(campaign_id, created_at desc);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  target_role app_role,
  campaign_id uuid references campaigns(id) on delete cascade,
  type text not null,
  title text not null,
  message text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_role_idx on notifications(target_role, is_read);

-- ---------- updated_at triggers ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['calendar_slots','campaigns','crm_decisions','content_submissions','qc_checklists']
  loop
    execute format('drop trigger if exists touch_%1$s on %1$s', t);
    execute format('create trigger touch_%1$s before update on %1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Keep slot occupancy in sync with campaign placement.
create or replace function public.sync_slot_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') and new.calendar_slot_id is not null then
    update calendar_slots set status = 'ASSIGNED' where id = new.calendar_slot_id;
  end if;
  if tg_op = 'UPDATE' and old.calendar_slot_id is not null
     and old.calendar_slot_id is distinct from new.calendar_slot_id then
    update calendar_slots set status = 'AVAILABLE' where id = old.calendar_slot_id;
  end if;
  if tg_op = 'DELETE' and old.calendar_slot_id is not null then
    update calendar_slots set status = 'AVAILABLE' where id = old.calendar_slot_id;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists campaigns_sync_slot on campaigns;
create trigger campaigns_sync_slot
  after insert or update or delete on campaigns
  for each row execute function public.sync_slot_status();
