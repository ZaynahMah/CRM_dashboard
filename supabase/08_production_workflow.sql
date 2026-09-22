-- =====================================================================
-- CLiQ Push Ops — Production workflow migration
-- Run EIGHTH. Adds: the DESIGN role (fixing a long-standing gap), the
-- Design and Emergency approval status fields, and the RLS policy Design
-- never had. This migration is what makes the upload-first production
-- workflow (no seeded/auto-generated campaigns) actually work end to end.
-- =====================================================================

-- ---------- fix: DESIGN was never added to the role enum ----------
do $$ begin
  alter type app_role add value if not exists 'DESIGN';
exception when duplicate_object then null; end $$;

-- ---------- fix: the auth trigger never recognized a DESIGN account ----------
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

-- ---------- new workflow status columns ----------
alter table campaigns add column if not exists design_status text not null default 'NOT_ASSIGNED'
  check (design_status in ('NOT_ASSIGNED','PENDING','SUBMITTED'));
alter table campaigns add column if not exists emergency_status text not null default 'PENDING'
  check (emergency_status in ('PENDING','ACCEPTED','REJECTED'));
alter table campaigns add column if not exists emergency_rejection_reason text;
alter table campaigns add column if not exists is_crm_self boolean not null default false;

-- ---------- fix: Design never had an RLS write policy at all ----------
drop policy if exists campaigns_design_write on campaigns;
create policy campaigns_design_write on campaigns for update to authenticated
  using (public.current_app_role()::text = 'DESIGN')
  with check (public.current_app_role()::text = 'DESIGN');
-- Compared as text, not cast to app_role — 'DESIGN' was just added to the
-- enum earlier in this same script/transaction, and Postgres forbids using
-- a brand-new enum value in an expression before that transaction commits.
-- (column-level restriction to creative_link/design_status is enforced in the
--  application layer via updateCampaign(), same pattern already used for
--  Category and Content elsewhere in this schema.)

-- ---------- controlled workflow functions for the new stages ----------

-- CRM accepts an emergency push: assigns it using the time Category supplied
-- (mandatory at creation time) and moves it into the normal review pipeline.
create or replace function public.accept_emergency(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crm() then raise exception 'Only CRM can accept an emergency push.'; end if;
  update campaigns
     set emergency_status = 'ACCEPTED'::text,
         crm_status = 'AWAITING_REVIEW'::crm_status
   where id = p_campaign_id;
end $$;

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

grant execute on function public.accept_emergency(uuid) to authenticated;
grant execute on function public.reject_emergency(uuid, text) to authenticated;

select
  (select count(*) from campaigns where design_status <> 'NOT_ASSIGNED') as design_assigned,
  (select count(*) from campaigns where is_crm_self) as crm_self_pns;
